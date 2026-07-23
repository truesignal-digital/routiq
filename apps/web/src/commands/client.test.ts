import { createSubmission } from "@asset/contracts";
import { describe, expect, it, vi } from "vitest";
import { createCommandClient } from "./client.js";
import { CommandStatusStore } from "./store.js";

const okOutcome = (commandId: string, idempotentReplay = false) => ({
  commandId,
  recordId: "rec-1",
  rowVersion: 1,
  warnings: [],
  idempotentReplay,
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeClient(fetchImpl: typeof fetch) {
  const store = new CommandStatusStore();
  const client = createCommandClient({
    getToken: () => "test-token",
    fetchImpl,
    store,
  });
  return { client, store };
}

describe("createCommandClient", () => {
  it("posts the submission and resolves committed", async () => {
    const submission = createSubmission("register-asset", 1, { code: "DLA-001" });
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("/v1/commands");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-token");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        name: "register-asset",
        version: 1,
        envelope: submission.envelope,
        payload: { code: "DLA-001" },
      });
      return jsonResponse(200, okOutcome(submission.envelope.commandId));
    });

    const { client, store } = makeClient(fetchImpl as typeof fetch);
    const result = await client.submit(submission);

    expect(result).toEqual({ ok: true, outcome: okOutcome(submission.envelope.commandId) });
    expect(store.get(submission.envelope.commandId)).toEqual({
      state: "committed",
      outcome: okOutcome(submission.envelope.commandId),
    });
  });

  it("marks submitting while the request is in flight", async () => {
    const submission = createSubmission("register-asset", 1, {});
    let observed: unknown;
    const { client, store } = makeClient((async () => {
      observed = store.get(submission.envelope.commandId);
      return jsonResponse(200, okOutcome(submission.envelope.commandId));
    }) as typeof fetch);

    await client.submit(submission);
    expect(observed).toEqual({ state: "submitting" });
  });

  it("an idempotent replay resolves committed — never a duplicate or an error", async () => {
    const submission = createSubmission("register-asset", 1, {});
    const { client, store } = makeClient((async () =>
      jsonResponse(200, okOutcome(submission.envelope.commandId, true))) as typeof fetch);

    const result = await client.submit(submission);
    expect(result.ok).toBe(true);
    expect(store.get(submission.envelope.commandId)?.state).toBe("committed");
  });

  it("an API error body resolves rejected with the stable code", async () => {
    const submission = createSubmission("register-asset", 1, {});
    const { client, store } = makeClient((async () =>
      jsonResponse(422, {
        error: { code: "VALIDATION_FAILED", metadata: { issues: [] } },
      })) as typeof fetch);

    const result = await client.submit(submission);
    expect(result).toEqual({ ok: false, code: "VALIDATION_FAILED", metadata: { issues: [] } });
    expect(store.get(submission.envelope.commandId)).toEqual({
      state: "rejected",
      code: "VALIDATION_FAILED",
      metadata: { issues: [] },
    });
  });

  it("a network failure resolves rejected NETWORK_ERROR and a retry reuses the same key", async () => {
    const submission = createSubmission("register-asset", 1, {});
    const seenKeys: string[] = [];
    let calls = 0;
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      seenKeys.push(JSON.parse(String(init?.body)).envelope.idempotencyKey);
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return jsonResponse(200, okOutcome(submission.envelope.commandId, true));
    }) as typeof fetch;

    const { client, store } = makeClient(fetchImpl);

    const first = await client.submit(submission);
    expect(first).toEqual({ ok: false, code: "NETWORK_ERROR" });
    expect(store.get(submission.envelope.commandId)?.state).toBe("rejected");

    const second = await client.submit(submission);
    expect(second.ok).toBe(true);
    expect(seenKeys[0]).toBe(seenKeys[1]);
  });

  it("a malformed success body resolves rejected, not committed", async () => {
    const submission = createSubmission("register-asset", 1, {});
    const { client, store } = makeClient((async () =>
      jsonResponse(200, { nonsense: true })) as typeof fetch);

    const result = await client.submit(submission);
    expect(result.ok).toBe(false);
    expect(store.get(submission.envelope.commandId)?.state).toBe("rejected");
  });
});
