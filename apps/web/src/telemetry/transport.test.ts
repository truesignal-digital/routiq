import type { TelemetryEvent } from "@routiq/contracts";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { createTransport, STORAGE_KEY } from "./transport.js";

function event(index: number): TelemetryEvent {
  return {
    kind: "vital",
    name: "LCP",
    value: index,
    sessionId: "00000000-0000-4000-8000-000000000000",
    occurredAt: "2026-10-05T10:00:00.000Z",
    route: "/",
    appVersion: "test",
  };
}

function accepted(): Response {
  return new Response(JSON.stringify({ accepted: 1 }), { status: 202 });
}

function sentBatches(fetchImpl: Mock<typeof fetch>): TelemetryEvent[][] {
  return fetchImpl.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as { events: TelemetryEvent[] }).events);
}

function stored(): TelemetryEvent[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as TelemetryEvent[];
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("telemetry transport", () => {
  it("flushes once twenty events are queued, with the token", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => accepted());
    const transport = createTransport({ endpoint: "/v1/telemetry", getToken: () => "tok", fetchImpl, storage: localStorage });

    for (let i = 0; i < 19; i++) transport.enqueue(event(i));
    expect(fetchImpl).not.toHaveBeenCalled();
    transport.enqueue(event(19));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("/v1/telemetry");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok");
    expect(sentBatches(fetchImpl)[0]).toHaveLength(20);
  });

  it("sends at most fifty events per request", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from({ length: 110 }, (_, i) => event(i))));
    const fetchImpl = vi.fn<typeof fetch>(async () => accepted());
    const transport = createTransport({ endpoint: "/v1/telemetry", getToken: () => undefined, fetchImpl, storage: localStorage });

    await transport.flush();

    expect(sentBatches(fetchImpl).map((batch) => batch.length)).toEqual([50, 50, 10]);
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has("authorization")).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("keeps events in localStorage while offline and sends them when the browser is back online", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetchImpl = vi.fn<typeof fetch>(async () => accepted());
    const transport = createTransport({ endpoint: "/v1/telemetry", getToken: () => undefined, fetchImpl, storage: localStorage });
    const stop = transport.start();

    transport.enqueue(event(1));
    transport.enqueue(event(2));
    await transport.flush();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(stored().map((e) => (e.kind === "vital" ? e.value : -1))).toEqual([1, 2]);

    online.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(sentBatches(fetchImpl)[0]).toHaveLength(2);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    stop();
  });

  it("stores a failed batch and backs off instead of retrying at once", async () => {
    let now = 1_000;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    const transport = createTransport({
      endpoint: "/v1/telemetry",
      getToken: () => undefined,
      fetchImpl,
      storage: localStorage,
      now: () => now,
    });

    transport.enqueue(event(1));
    await transport.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(stored()).toHaveLength(1);

    transport.enqueue(event(2));
    await transport.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(stored()).toHaveLength(2);

    now += 15_000;
    fetchImpl.mockImplementation(async () => accepted());
    await transport.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sentBatches(fetchImpl)[1]).toHaveLength(2);
  });

  it("drops a batch the server rejects as invalid", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 400 }));
    const transport = createTransport({ endpoint: "/v1/telemetry", getToken: () => undefined, fetchImpl, storage: localStorage });

    transport.enqueue(event(1));
    await transport.flush();
    await transport.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("keeps only the newest two hundred events in the ring buffer", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const transport = createTransport({
      endpoint: "/v1/telemetry",
      getToken: () => undefined,
      fetchImpl: vi.fn<typeof fetch>(async () => accepted()),
      storage: localStorage,
    });

    for (let round = 0; round < 25; round++) {
      for (let i = 0; i < 10; i++) transport.enqueue(event(round * 10 + i));
      await transport.flush();
    }

    const values = stored().map((e) => (e.kind === "vital" ? e.value : -1));
    expect(values).toHaveLength(200);
    expect(values[0]).toBe(50);
    expect(values.at(-1)).toBe(249);
  });
});
