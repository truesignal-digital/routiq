import { describe, expect, it, vi } from "vitest";
import { createCommandClient } from "./client.js";
import { createCommandIntent } from "./intent.js";
import { CommandStatusStore } from "./store.js";

function okResponse(commandId: string, idempotentReplay: boolean): Response {
  return new Response(
    JSON.stringify({ commandId, recordId: "r", rowVersion: 1, warnings: [], idempotentReplay }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("createCommandIntent", () => {
  it("timeout then retry posts the identical envelope; replay is plain success", async () => {
    const bodies: Array<{ envelope: { idempotencyKey: string; commandId: string } }> = [];
    let calls = 0;
    const fetchImpl = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      calls += 1;
      if (calls === 1) throw new TypeError("timeout");
      return okResponse(body.envelope.commandId, true);
    }) as typeof fetch;

    const client = createCommandClient({
      store: new CommandStatusStore(),
      getToken: () => "t",
      fetchImpl,
    });
    const intent = createCommandIntent<{ code: string }>(client, "register-asset", 1);

    const first = await intent.submit({ code: "A" });
    expect(first.ok).toBe(false);
    const second = await intent.submit({ code: "A" });
    expect(second.ok).toBe(true);
    expect(bodies[0]?.envelope).toEqual(bodies[1]?.envelope);
  });

  it("edited payload gets a fresh envelope", async () => {
    const keys: string[] = [];
    const fetchImpl = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      keys.push(body.envelope.idempotencyKey);
      return okResponse(body.envelope.commandId, false);
    }) as typeof fetch;
    const client = createCommandClient({
      store: new CommandStatusStore(),
      getToken: () => "t",
      fetchImpl,
    });
    const intent = createCommandIntent<{ code: string }>(client, "register-asset", 1);
    await intent.submit({ code: "A" });
    await intent.submit({ code: "B" });
    expect(keys[0]).not.toBe(keys[1]);
  });
});
