import { createSubmission, telemetryEvent, type TelemetryEvent } from "@routiq/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCommandClient } from "../commands/client.js";
import { CommandStatusStore } from "../commands/store.js";
import { parseServerTiming, stripQueryStrings } from "./collect.js";
import { flushTelemetry, reportError, startTelemetry, stopTelemetry, telemetryEnabled } from "./index.js";

function telemetryFetch() {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ accepted: 1 }), { status: 202 }));
}

function sent(fetchImpl: ReturnType<typeof telemetryFetch>): TelemetryEvent[] {
  return fetchImpl.mock.calls.flatMap(
    ([, init]) => (JSON.parse(String(init?.body)) as { events: TelemetryEvent[] }).events,
  );
}

afterEach(() => {
  stopTelemetry();
  localStorage.clear();
});

describe("telemetry", () => {
  it("stays off in test mode unless a test turns it on", async () => {
    expect(telemetryEnabled()).toBe(false);
    expect(telemetryEnabled(true)).toBe(true);

    const fetchImpl = telemetryFetch();
    startTelemetry({ getToken: () => undefined, fetchImpl, storage: localStorage });
    reportError(new Error("boom"), "window");
    await flushTelemetry();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("times a command from submit to paint, with the server's share", async () => {
    const fetchImpl = telemetryFetch();
    startTelemetry({ enabled: true, getToken: () => "tok", fetchImpl, storage: localStorage });

    const submission = createSubmission("register-asset", 1, { code: "DLA-001" });
    const client = createCommandClient({
      store: new CommandStatusStore(),
      getToken: () => "tok",
      fetchImpl: async () =>
        new Response(JSON.stringify({ commandId: submission.envelope.commandId, recordId: "r1", rowVersion: 1, warnings: [] }), {
          status: 200,
          headers: { "content-type": "application/json", "server-timing": "db;dur=3, app;dur=42.5" },
        }),
    });
    await client.submit(submission);

    await vi.waitFor(async () => {
      await flushTelemetry();
      expect(sent(fetchImpl).some((e) => e.kind === "journey")).toBe(true);
    });
    const journey = sent(fetchImpl).find((e) => e.kind === "journey");
    expect(journey).toMatchObject({ name: "command:register-asset", outcome: "ok", serverMs: 42.5, appVersion: expect.any(String) });
    expect(telemetryEvent.safeParse(journey).success).toBe(true);
  });

  it("tags events with the version index.html names, or dev without one", async () => {
    const meta = Object.assign(document.createElement("meta"), { name: "routiq-version", content: "9c0e874" });
    document.head.append(meta);
    try {
      const fetchImpl = telemetryFetch();
      startTelemetry({ enabled: true, getToken: () => "tok", fetchImpl, storage: localStorage });
      reportError(new Error("boom"), "window");
      await flushTelemetry();
      expect(sent(fetchImpl)[0]).toMatchObject({ appVersion: "9c0e874" });
    } finally {
      meta.remove();
    }
    stopTelemetry();

    const fetchImpl = telemetryFetch();
    startTelemetry({ enabled: true, getToken: () => "tok", fetchImpl, storage: localStorage });
    reportError(new Error("boom"), "window");
    await flushTelemetry();
    expect(sent(fetchImpl)[0]).toMatchObject({ appVersion: "dev" });
  });

  it("reports a command that never reached the server as offline", async () => {
    const fetchImpl = telemetryFetch();
    startTelemetry({ enabled: true, getToken: () => undefined, fetchImpl, storage: localStorage });

    const client = createCommandClient({
      store: new CommandStatusStore(),
      getToken: () => undefined,
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await client.submit(createSubmission("approve-entry", 1, {}));

    await vi.waitFor(async () => {
      await flushTelemetry();
      expect(sent(fetchImpl).find((e) => e.kind === "journey")).toMatchObject({ name: "command:approve-entry", outcome: "offline" });
    });
  });

  it("truncates errors to the contract and strips query strings", async () => {
    const fetchImpl = telemetryFetch();
    startTelemetry({ enabled: true, getToken: () => undefined, fetchImpl, storage: localStorage });

    const error = new Error(`Failed to load https://demo.example/v1/assets?token=secret&q=DLA ${"x".repeat(900)}`);
    error.stack = `Error\n    at load (http://localhost:5173/src/assets/useAssets.ts?t=1712:10:5)\n${"y".repeat(3000)}`;
    reportError(error, "react");
    reportError(error, "react");
    await flushTelemetry();

    const errors = sent(fetchImpl).filter((e) => e.kind === "error");
    expect(errors).toHaveLength(1);
    const [reported] = errors;
    if (reported?.kind !== "error") throw new Error("expected an error event");
    expect(reported.source).toBe("react");
    expect(reported.message).toMatch(/^Failed to load https:\/\/demo\.example\/v1\/assets x+$/);
    expect(reported.message).toHaveLength(500);
    expect(reported.stack).toContain("(http://localhost:5173/src/assets/useAssets.ts:10:5)");
    expect(reported.stack).toHaveLength(2000);
    expect(telemetryEvent.safeParse(reported).success).toBe(true);
  });
});

describe("telemetry helpers", () => {
  it("strips query strings from URLs and leaves other question marks alone", () => {
    expect(stripQueryStrings("GET /v1/assets?cursor=abc failed")).toBe("GET /v1/assets failed");
    expect(stripQueryStrings("Is it ok? yes")).toBe("Is it ok? yes");
  });

  it("reads the app duration from Server-Timing", () => {
    expect(parseServerTiming("app;dur=12")).toBe(12);
    expect(parseServerTiming("db;dur=3, app;desc=\"x\";dur=7.25")).toBe(7.3);
    expect(parseServerTiming("db;dur=3")).toBeUndefined();
    expect(parseServerTiming(null)).toBeUndefined();
  });
});
