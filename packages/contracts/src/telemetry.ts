import { z } from "zod";

/**
 * Field telemetry the web app sends to `POST /v1/telemetry` (ADR-0011). It is
 * measurement, not business state: it never goes through the command
 * pipeline, never carries what a user typed, and never names a person. The
 * server adds the workspace and role from the session, when there is one.
 */

/** Route paths with ids replaced, so `/activities/0f…` and `/activities/1a…` group together. */
export function routeTemplate(path: string): string {
  return path
    .split("?")[0]!
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\/\d{3,}(?=\/|$)/g, "/:n")
    .slice(0, 200);
}

const ms = z.number().nonnegative().max(600_000);

export const telemetryDevice = z.object({
  userAgent: z.string().max(300),
  mobile: z.boolean().optional(),
  platform: z.string().max(60).optional(),
  /** navigator.deviceMemory: a coarse bucket (0.25 … 8) in Chromium. */
  deviceMemoryGb: z.number().nonnegative().max(1024).optional(),
  cpuCores: z.number().int().nonnegative().max(1024).optional(),
  connection: z
    .object({
      effectiveType: z.string().max(10).optional(),
      downlinkMbps: z.number().nonnegative().max(100_000).optional(),
      rttMs: z.number().nonnegative().max(60_000).optional(),
      saveData: z.boolean().optional(),
    })
    .optional(),
  screen: z.object({ width: z.number().int().nonnegative(), height: z.number().int().nonnegative(), dpr: z.number().positive().max(10) }).optional(),
  language: z.string().max(20).optional(),
  online: z.boolean().optional(),
});
export type TelemetryDevice = z.infer<typeof telemetryDevice>;

const base = {
  /** Random per page load, so one load's events read together. Not tied to a person. */
  sessionId: z.uuid(),
  occurredAt: z.iso.datetime(),
  /** A route template (see routeTemplate), never a full URL. */
  route: z.string().max(200),
  /** The build that produced the event, so a release can be compared with the last. */
  appVersion: z.string().max(40),
};

export const VITAL_NAMES = ["TTFB", "FCP", "LCP", "CLS", "INP"] as const;
export const JOURNEY_OUTCOMES = ["ok", "error", "offline"] as const;

export const telemetryEvent = z.discriminatedUnion("kind", [
  /** One per page load: what the device and network are, and how the load went. */
  z.object({
    kind: z.literal("session"),
    ...base,
    device: telemetryDevice,
    navigation: z
      .object({ ttfbMs: ms, domContentLoadedMs: ms, loadMs: ms, transferBytes: z.number().int().nonnegative() })
      .partial()
      .optional(),
  }),
  /** An uncaught error or rejection, or one a React error boundary caught. */
  z.object({
    kind: z.literal("error"),
    ...base,
    source: z.enum(["window", "promise", "react"]),
    message: z.string().max(500),
    stack: z.string().max(2000).optional(),
  }),
  /** A Core Web Vital for the page load (CLS is unitless; the rest are ms). */
  z.object({
    kind: z.literal("vital"),
    ...base,
    name: z.enum(VITAL_NAMES),
    value: z.number().nonnegative().max(600_000),
  }),
  /**
   * A user journey: from a user action to its result on screen.
   * Names are `<kind>:<what>`, e.g. `command:approve-entry`, `route:/finance/approvals`, `app:usable`.
   */
  z.object({
    kind: z.literal("journey"),
    ...base,
    name: z.string().max(120).regex(/^[a-z]+:[\w\-/:.$]+$/),
    durationMs: ms,
    outcome: z.enum(JOURNEY_OUTCOMES),
    /** Server time for the request inside the journey, from its Server-Timing header. */
    serverMs: ms.optional(),
  }),
]);
export type TelemetryEvent = z.infer<typeof telemetryEvent>;

export const TELEMETRY_BATCH_MAX = 50;

export const telemetryBatch = z.object({ events: z.array(telemetryEvent).min(1).max(TELEMETRY_BATCH_MAX) });
export type TelemetryBatch = z.infer<typeof telemetryBatch>;
