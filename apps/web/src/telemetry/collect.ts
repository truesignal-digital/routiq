import type { TelemetryDevice, TelemetryEvent } from "@routiq/contracts";

type SessionEvent = Extract<TelemetryEvent, { kind: "session" }>;
export type NavigationTiming = NonNullable<SessionEvent["navigation"]>;

const MAX_MS = 600_000;
const MESSAGE_MAX = 500;
const STACK_MAX = 2000;

/** Rounded to 0.1 ms and kept inside the contract's bounds. */
export function toMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_MS, Math.max(0, Math.round(value * 10) / 10));
}

function bounded(value: unknown, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(value, max) : undefined;
}

/** Chromium-only navigator fields the DOM lib does not type. */
interface NavigatorHints {
  userAgentData?: { mobile?: unknown; platform?: unknown };
  deviceMemory?: unknown;
  connection?: { effectiveType?: unknown; downlink?: unknown; rtt?: unknown; saveData?: unknown };
}

export function deviceProfile(): TelemetryDevice {
  const nav = navigator as Navigator & NavigatorHints;
  const device: TelemetryDevice = { userAgent: nav.userAgent.slice(0, 300) };

  const hints = nav.userAgentData;
  if (typeof hints?.mobile === "boolean") device.mobile = hints.mobile;
  if (typeof hints?.platform === "string" && hints.platform !== "") device.platform = hints.platform.slice(0, 60);

  const memory = bounded(nav.deviceMemory, 1024);
  if (memory !== undefined) device.deviceMemoryGb = memory;
  const cores = bounded(nav.hardwareConcurrency, 1024);
  if (cores !== undefined) device.cpuCores = Math.floor(cores);

  const link = nav.connection;
  if (link !== undefined) {
    const connection: NonNullable<TelemetryDevice["connection"]> = {};
    if (typeof link.effectiveType === "string") connection.effectiveType = link.effectiveType.slice(0, 10);
    const downlink = bounded(link.downlink, 100_000);
    if (downlink !== undefined) connection.downlinkMbps = downlink;
    const rtt = bounded(link.rtt, 60_000);
    if (rtt !== undefined) connection.rttMs = rtt;
    if (typeof link.saveData === "boolean") connection.saveData = link.saveData;
    device.connection = connection;
  }

  if (typeof screen !== "undefined" && window.devicePixelRatio > 0) {
    device.screen = {
      width: Math.max(0, Math.round(screen.width)),
      height: Math.max(0, Math.round(screen.height)),
      dpr: Math.min(10, window.devicePixelRatio),
    };
  }
  if (nav.language !== "") device.language = nav.language.slice(0, 20);
  device.online = nav.onLine;
  return device;
}

export function navigationEntry(): PerformanceNavigationTiming | undefined {
  try {
    const [entry] = performance.getEntriesByType("navigation");
    return entry as PerformanceNavigationTiming | undefined;
  } catch {
    return undefined;
  }
}

/** Read after the load event has finished; zero means the step never happened. */
export function navigationTiming(): NavigationTiming | undefined {
  const entry = navigationEntry();
  if (entry === undefined) return undefined;
  const timing: NavigationTiming = {};
  if (entry.responseStart > 0) timing.ttfbMs = toMs(entry.responseStart);
  if (entry.domContentLoadedEventEnd > 0) timing.domContentLoadedMs = toMs(entry.domContentLoadedEventEnd);
  if (entry.loadEventEnd > 0) timing.loadMs = toMs(entry.loadEventEnd);
  if (entry.transferSize >= 0) timing.transferBytes = Math.round(entry.transferSize);
  return timing;
}

/**
 * Query strings can carry tokens and search terms. The query ends at whitespace
 * or a quote, or before a stack frame's `:line:col`.
 */
export function stripQueryStrings(text: string): string {
  return text.replace(
    /((?:\b[a-z][a-z\d+.-]*:\/\/|\/)[^\s?#"'`<>()]*)\?[^\s#"'`<>()]*?(?=:\d+:\d+|[\s#"'`<>()]|$)/gi,
    "$1",
  );
}

export function errorDetails(error: unknown): { message: string; stack?: string } {
  let message: string;
  let stack: string | undefined;
  if (error instanceof Error) {
    message = error.message || error.name;
    stack = error.stack;
  } else if (typeof error === "string") {
    message = error;
  } else {
    try {
      message = JSON.stringify(error) ?? String(error);
    } catch {
      message = String(error);
    }
  }
  const details: { message: string; stack?: string } = {
    message: stripQueryStrings(message).slice(0, MESSAGE_MAX),
  };
  if (stack) details.stack = stripQueryStrings(stack).slice(0, STACK_MAX);
  return details;
}

/** The `app;dur=<ms>` entry of a Server-Timing header. */
export function parseServerTiming(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  for (const metric of header.split(",")) {
    const [name, ...params] = metric.split(";").map((part) => part.trim());
    if (name !== "app") continue;
    for (const param of params) {
      const match = /^dur=("?)([\d.]+)\1$/.exec(param);
      if (match?.[2] !== undefined) {
        const value = Number(match[2]);
        if (Number.isFinite(value)) return toMs(value);
      }
    }
  }
  return undefined;
}

/** Schedules on the next frame; falls back to a timer where frames never come. Returns a cancel. */
export function nextFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === "function" && document.visibilityState !== "hidden") {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
}

/** Two frames after now: React has committed and the browser has painted the result. */
export function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    nextFrame(() => nextFrame(resolve));
  });
}
