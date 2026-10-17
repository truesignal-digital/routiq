import { routeTemplate, type TelemetryEvent } from "@routiq/contracts";
import { afterPaint, deviceProfile, errorDetails, navigationTiming, parseServerTiming, toMs } from "./collect.js";
import { journeyName, trackRoutes, type JourneyOutcome, type QueryActivity, type RouterEvents } from "./journeys.js";
import { createTransport, type Transport } from "./transport.js";
import { observeVitals } from "./vitals.js";

export type { JourneyOutcome } from "./journeys.js";
export type ErrorSource = Extract<TelemetryEvent, { kind: "error" }>["source"];

type CommonField = "sessionId" | "occurredAt" | "route" | "appVersion";
type WithoutCommon<E> = E extends unknown ? Omit<E, CommonField> : never;
type EventBody = WithoutCommon<TelemetryEvent>;

export interface TelemetryOptions {
  /** The signed-in user's token, sent so the server can attach workspace and role. */
  getToken: () => string | undefined;
  queryClient?: QueryActivity;
  router?: RouterEvents;
  /** Overrides the default: off under `MODE === "test"`, on otherwise. `VITE_TELEMETRY=off` always wins. */
  enabled?: boolean;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  storage?: Storage;
}

export interface Journey {
  /** Pass the response when there is one: its Server-Timing gives the server's share. */
  end(outcome: JourneyOutcome, response?: Response): void;
}

const ERRORS_PER_LOAD = 25;

interface Runtime {
  record(body: EventBody, route?: string): void;
  reportError(error: unknown, source: ErrorSource): void;
  flush(): Promise<void>;
  stop(): void;
}

let active: Runtime | undefined;

export function telemetryEnabled(override?: boolean): boolean {
  if (import.meta.env.VITE_TELEMETRY === "off") return false;
  if (import.meta.env.MODE === "test") return override === true;
  return override ?? true;
}

function currentRoute(): string {
  return routeTemplate(window.location.pathname);
}

function appVersion(): string {
  return document.querySelector('meta[name="routiq-version"]')?.getAttribute("content")?.slice(0, 40) || "dev";
}

/** Starts field telemetry once per page load. Never throws. */
export function startTelemetry(options: TelemetryOptions): void {
  try {
    if (active !== undefined || !telemetryEnabled(options.enabled)) return;
    active = createRuntime(options);
  } catch {
    active = undefined;
  }
}

/** Stops listeners and timers; tests call it between cases. */
export function stopTelemetry(): void {
  active?.stop();
  active = undefined;
}

/** Sends what is queued now. Tests use it; the app relies on the timers. */
export function flushTelemetry(): Promise<void> {
  return active?.flush() ?? Promise.resolve();
}

export function reportError(error: unknown, source: ErrorSource): void {
  active?.reportError(error, source);
}

const inactiveJourney: Journey = { end() {} };

/** Times a user action from now until its result has been painted. */
export function startJourney(kind: string, what: string): Journey {
  const runtime = active;
  if (runtime === undefined) return inactiveJourney;
  try {
    const startedAt = performance.now();
    const route = currentRoute();
    const name = journeyName(kind, what);
    let ended = false;
    return {
      end(outcome, response) {
        if (ended) return;
        ended = true;
        try {
          const serverMs = parseServerTiming(response?.headers.get("server-timing"));
          void afterPaint().then(() => {
            runtime.record(
              {
                kind: "journey",
                name,
                durationMs: toMs(performance.now() - startedAt),
                outcome,
                ...(serverMs === undefined ? {} : { serverMs }),
              },
              route,
            );
          });
        } catch {
          // Measurement only.
        }
      },
    };
  } catch {
    return inactiveJourney;
  }
}

function createRuntime(options: TelemetryOptions): Runtime {
  const sessionId = crypto.randomUUID();
  const version = appVersion();
  const storage = options.storage ?? safeLocalStorage();
  const transport: Transport = createTransport({
    endpoint: options.endpoint ?? "/v1/telemetry",
    getToken: () => {
      try {
        return options.getToken();
      } catch {
        return undefined;
      }
    },
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    storage,
  });

  const record = (body: EventBody, route = currentRoute()) => {
    try {
      transport.enqueue({
        ...body,
        sessionId,
        occurredAt: new Date().toISOString(),
        route,
        appVersion: version,
      } as TelemetryEvent);
    } catch {
      // Measurement only.
    }
  };

  const errorsSeen = new Set<string>();
  const reportErrorEvent = (error: unknown, source: ErrorSource) => {
    try {
      const { message, stack } = errorDetails(error);
      const key = `${source}:${message}`;
      if (errorsSeen.has(key) || errorsSeen.size >= ERRORS_PER_LOAD) return;
      errorsSeen.add(key);
      record({ kind: "error", source, message, ...(stack === undefined ? {} : { stack }) });
    } catch {
      // Reporting an error must not raise another.
    }
  };

  const cleanups: (() => void)[] = [transport.start()];
  const listen = <K extends keyof WindowEventMap>(type: K, handler: (event: WindowEventMap[K]) => void) => {
    window.addEventListener(type, handler);
    cleanups.push(() => window.removeEventListener(type, handler));
  };

  listen("error", (event) => reportErrorEvent(event.error ?? event.message, "window"));
  listen("unhandledrejection", (event) => reportErrorEvent(event.reason, "promise"));

  const vitals = observeVitals((name, value) => record({ kind: "vital", name, value }));
  cleanups.push(() => vitals.stop());

  let hiddenOnce = false;
  const onHidden = () => {
    if (!hiddenOnce) {
      hiddenOnce = true;
      vitals.onHidden();
    }
    void transport.flush({ keepalive: true });
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") onHidden();
  };
  document.addEventListener("visibilitychange", onVisibility);
  cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));
  listen("pagehide", onHidden);

  // loadEventEnd is still 0 inside the load handler itself.
  const afterLoad = () => {
    const timer = setTimeout(() => {
      try {
        const navigation = navigationTiming();
        record({ kind: "session", device: deviceProfile(), ...(navigation === undefined ? {} : { navigation }) });
        vitals.afterLoad();
      } catch {
        // Measurement only.
      }
    }, 0);
    cleanups.push(() => clearTimeout(timer));
  };
  if (document.readyState === "complete") afterLoad();
  else listen("load", afterLoad);

  if (options.router !== undefined && options.queryClient !== undefined) {
    cleanups.push(trackRoutes(options.router, options.queryClient, (journey) => record({ kind: "journey", ...journey })));
  }

  return {
    record,
    reportError: reportErrorEvent,
    flush: () => transport.flush(),
    stop() {
      for (const cleanup of cleanups.splice(0)) {
        try {
          cleanup();
        } catch {
          // Keep stopping the rest.
        }
      }
    },
  };
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
