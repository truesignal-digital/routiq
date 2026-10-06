import { describe, expect, it } from "vitest";
import { routeTemplate, telemetryBatch } from "./telemetry.js";

const base = { sessionId: "0f8fad5b-d9cb-469f-a165-70867728950e", occurredAt: "2026-10-05T10:00:00.000Z", route: "/", appVersion: "abc1234" };

describe("routeTemplate", () => {
  it("replaces ids and long numbers and drops the query", () => {
    expect(routeTemplate("/activities/0f8fad5b-d9cb-469f-a165-70867728950e/legs?tab=x")).toBe("/activities/:id/legs");
    expect(routeTemplate("/finance/entries/12345")).toBe("/finance/entries/:n");
    expect(routeTemplate("/finance/approvals")).toBe("/finance/approvals");
  });
});

describe("telemetryBatch", () => {
  it("accepts each kind of event", () => {
    const parsed = telemetryBatch.safeParse({
      events: [
        { ...base, kind: "session", device: { userAgent: "Mozilla/5.0", deviceMemoryGb: 2, cpuCores: 4, connection: { effectiveType: "3g", rttMs: 300 } } },
        { ...base, kind: "error", source: "window", message: "TypeError: x is undefined" },
        { ...base, kind: "vital", name: "LCP", value: 2400 },
        { ...base, kind: "journey", name: "command:approve-entry", durationMs: 830, outcome: "ok", serverMs: 41 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses empty or oversized batches, unknown kinds and free-form journey names", () => {
    expect(telemetryBatch.safeParse({ events: [] }).success).toBe(false);
    expect(telemetryBatch.safeParse({ events: Array.from({ length: 51 }, () => ({ ...base, kind: "vital", name: "CLS", value: 0 })) }).success).toBe(false);
    expect(telemetryBatch.safeParse({ events: [{ ...base, kind: "click" }] }).success).toBe(false);
    expect(telemetryBatch.safeParse({ events: [{ ...base, kind: "journey", name: "Approved Nadège's entry", durationMs: 1, outcome: "ok" }] }).success).toBe(false);
  });
});
