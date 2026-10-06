import { TELEMETRY_BATCH_MAX, type TelemetryEvent } from "@routiq/contracts";

export const STORAGE_KEY = "routiq.telemetry.v1";
export const STORED_MAX = 200;
export const FLUSH_THRESHOLD = 20;
export const FLUSH_INTERVAL_MS = 15_000;
const BACKOFF_START_MS = 15_000;
const BACKOFF_MAX_MS = 5 * 60_000;

export interface TransportOptions {
  endpoint: string;
  getToken: () => string | undefined;
  fetchImpl?: typeof fetch;
  storage?: Storage | undefined;
  now?: () => number;
}

export interface Transport {
  enqueue(event: TelemetryEvent): void;
  /** `keepalive` is for a page being hidden: it sends only what is in memory, so the body stays small. */
  flush(options?: { keepalive?: boolean }): Promise<void>;
  /** Starts the interval and the `online` retry. Returns the cleanup. */
  start(): () => void;
}

type SendResult = "sent" | "drop" | "retry";

/**
 * Batches events to the telemetry endpoint. Events that cannot go out wait in a
 * localStorage ring buffer and go with the next flush. Every path swallows its
 * own failures: telemetry must never surface to the user.
 */
export function createTransport({
  endpoint,
  getToken,
  fetchImpl = (input, init) => fetch(input, init),
  storage,
  now = Date.now,
}: TransportOptions): Transport {
  const queue: TelemetryEvent[] = [];
  let failures = 0;
  let retryAt = 0;

  function readStored(): TelemetryEvent[] {
    if (storage === undefined) return [];
    try {
      const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter(isStoredEvent) : [];
    } catch {
      return [];
    }
  }

  function writeStored(events: TelemetryEvent[]): void {
    if (storage === undefined) return;
    try {
      if (events.length === 0) storage.removeItem(STORAGE_KEY);
      else storage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-STORED_MAX)));
    } catch {
      // Quota or private mode: the events are lost, the app is not.
    }
  }

  function persist(events: TelemetryEvent[]): void {
    if (events.length === 0) return;
    writeStored([...readStored(), ...events]);
  }

  function takeStored(): TelemetryEvent[] {
    const stored = readStored();
    if (stored.length > 0) writeStored([]);
    return stored;
  }

  function backOff(): void {
    failures += 1;
    retryAt = now() + Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** (failures - 1));
  }

  async function send(batch: TelemetryEvent[], keepalive: boolean): Promise<SendResult> {
    try {
      const token = getToken();
      const response = await fetchImpl(endpoint, {
        method: "POST",
        keepalive,
        headers: {
          "content-type": "application/json",
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ events: batch }),
      });
      if (response.ok) return "sent";
      // A batch the server refuses as malformed would be refused forever.
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
        return "drop";
      }
      return "retry";
    } catch {
      return "retry";
    }
  }

  async function flush({ keepalive = false }: { keepalive?: boolean } = {}): Promise<void> {
    try {
      if (navigator.onLine === false || now() < retryAt) {
        persist(queue.splice(0));
        return;
      }
      const events = keepalive ? queue.splice(0) : [...takeStored(), ...queue.splice(0)];
      for (let start = 0; start < events.length; start += TELEMETRY_BATCH_MAX) {
        const result = await send(events.slice(start, start + TELEMETRY_BATCH_MAX), keepalive);
        if (result === "retry") {
          persist(events.slice(start));
          backOff();
          return;
        }
      }
      failures = 0;
      retryAt = 0;
    } catch {
      // Never let telemetry reject into the app.
    }
  }

  return {
    enqueue(event) {
      queue.push(event);
      if (queue.length > STORED_MAX) queue.splice(0, queue.length - STORED_MAX);
      if (queue.length >= FLUSH_THRESHOLD) void flush();
    },
    flush,
    start() {
      const interval = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
      const onOnline = () => {
        failures = 0;
        retryAt = 0;
        void flush();
      };
      window.addEventListener("online", onOnline);
      return () => {
        clearInterval(interval);
        window.removeEventListener("online", onOnline);
      };
    },
  };
}

function isStoredEvent(value: unknown): value is TelemetryEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TelemetryEvent).kind === "string" &&
    typeof (value as TelemetryEvent).sessionId === "string"
  );
}
