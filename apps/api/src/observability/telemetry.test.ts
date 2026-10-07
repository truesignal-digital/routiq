import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedWorkspace } from "../test/seed.js";
import { errorFingerprint, makeRateLimiter, pruneTelemetry } from "./telemetry.js";

const event = (over: Record<string, unknown> = {}) => ({
  sessionId: randomUUID(),
  occurredAt: new Date().toISOString(),
  route: "/finance/approvals",
  appVersion: "test",
  kind: "journey",
  name: "command:approve-entry",
  durationMs: 812,
  outcome: "ok",
  serverMs: 37.5,
  ...over,
});

describe("POST /v1/telemetry", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let finance: Actor;
  let workspaceId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    workspaceId = (await seedWorkspace(ctx.db)).workspace.id;
    finance = await seedActor(ctx.db, { workspaceId, role: "FINANCE" });
  });

  afterAll(async () => {
    await ctx.close();
  });

  const post = (body: unknown, token?: string) =>
    ctx.app.inject({
      method: "POST",
      url: "/v1/telemetry",
      payload: body as Record<string, unknown>,
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });

  const rowsFor = async (sessionId: string) =>
    (await ctx.db.execute(sql`select * from telemetry.events where session_id = ${sessionId}`)).rows as Array<Record<string, unknown>>;

  it("stores a signed-in batch with the workspace and role from the session, never from the body", async () => {
    const sent = event({ route: "/activities/0f8fad5b-d9cb-469f-a165-70867728950e" });
    const res = await post({ events: [{ ...sent, workspaceId: randomUUID(), role: "DIRECTOR" }] }, finance.token);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: 1 });
    const [row] = await rowsFor(sent.sessionId);
    expect(row).toMatchObject({ workspace_id: workspaceId, role: "FINANCE", kind: "journey", name: "command:approve-entry", value: 812, server_ms: 37.5, outcome: "ok", route: "/activities/:id" });
  });

  it("accepts events before sign-in and from an expired session, without a workspace", async () => {
    const anonymous = event({ kind: "error", source: "window", message: "TypeError: x is undefined", stack: "at App (http://x/src/App.tsx:10:5)" });
    delete (anonymous as Record<string, unknown>)["name"];
    expect((await post({ events: [anonymous] })).statusCode).toBe(202);
    expect((await post({ events: [anonymous] }, "not-a-token")).statusCode).toBe(202);
    const rows = await rowsFor(anonymous.sessionId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ workspace_id: null, role: null, kind: "error", name: "window" });
    expect(rows[0]?.["fingerprint"]).toMatch(/^[0-9a-f]{16}$/);
  });

  it("refuses a malformed batch", async () => {
    expect((await post({ events: [] })).statusCode).toBe(400);
    expect((await post({ events: [event({ kind: "keystroke" })] })).statusCode).toBe(400);
  });

  it("puts a Server-Timing header on every response", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(res.headers["server-timing"]).toMatch(/^app;dur=\d+(\.\d)?$/);
  });

  it("lets the runtime role write events but never read them back", async () => {
    const denied = async (query: Promise<unknown>) => {
      const error = await query.then(() => undefined, (e: unknown) => e as { cause?: { message?: string } });
      return error?.cause?.message ?? "";
    };
    expect(await denied(ctx.runtimeDb.execute(sql`select message from telemetry.events limit 1`))).toMatch(/permission denied/);
    expect(await denied(ctx.runtimeDb.execute(sql`update telemetry.events set role = 'DIRECTOR'`))).toMatch(/permission denied/);
  });
});

// Its own database: every test app prunes at boot, so on the shared one another
// file starting up can delete this test's expired row before its own prune runs.
describe("telemetry retention", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp({ isolated: true });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("prunes events past retention with the runtime role, and keeps recent ones", async () => {
    const workspaceId = (await seedWorkspace(ctx.db)).workspace.id;
    const finance = await seedActor(ctx.db, { workspaceId, role: "FINANCE" });
    const old = event();
    const recent = event();
    for (const sent of [old, recent]) {
      const res = await ctx.app.inject({ method: "POST", url: "/v1/telemetry", payload: { events: [sent] }, headers: { authorization: `Bearer ${finance.token}` } });
      expect(res.statusCode).toBe(202);
    }
    await ctx.db.execute(sql`update telemetry.events set received_at = now() - interval '91 days' where session_id = ${old.sessionId}`);
    expect(await pruneTelemetry(ctx.runtimeDb)).toBe(1);
    const left = (await ctx.db.execute(sql`select session_id from telemetry.events`)).rows as Array<{ session_id: string }>;
    expect(left.map((row) => row.session_id)).toEqual([recent.sessionId]);
  });
});

describe("command receipts", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("record how long the server took, for executed and rejected commands alike", async () => {
    const workspaceId = (await seedWorkspace(ctx.db)).workspace.id;
    const admin = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    const api = apiClient(ctx.app);
    const name = `Agence ${randomUUID().slice(0, 6)}`;
    const code = randomUUID().slice(0, 4).toUpperCase();
    expect((await api.send(admin.token, "create-branch", { branchId: randomUUID(), code, name })).status).toBe(200);
    expect((await api.send(admin.token, "create-branch", { branchId: randomUUID(), code, name: `${name} bis` })).body.error?.code).toBe("DUPLICATE_BRANCH_CODE");
    const rows = (
      await ctx.db.execute(sql`select status, duration_ms from commands where workspace_id = ${workspaceId} and command_type = 'create-branch' order by executed_at`)
    ).rows as Array<{ status: string; duration_ms: number | null }>;
    expect(rows.map((row) => row.status)).toEqual(["EXECUTED", "REJECTED"]);
    for (const row of rows) expect(row.duration_ms).toBeGreaterThanOrEqual(0);
  });
});

describe("errorFingerprint", () => {
  it("groups the same error across values and builds, and splits different places", () => {
    const a = errorFingerprint('Cannot read "x" of entry 41', "TypeError\n    at f (http://h/static/index-AbC12345.js:1:200)");
    const b = errorFingerprint('Cannot read "y" of entry 97', "TypeError\n    at f (http://h/static/index-ZzZ98765.js:1:999)");
    const c = errorFingerprint('Cannot read "x" of entry 41', "TypeError\n    at g (http://h/src/Other.tsx:3:1)");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("makeRateLimiter", () => {
  it("allows a sender its budget per minute, then refuses until the window turns", () => {
    let now = 0;
    const allow = makeRateLimiter(100, () => now);
    expect(allow("ws", 60)).toBe(true);
    expect(allow("ws", 40)).toBe(true);
    expect(allow("ws", 1)).toBe(false);
    expect(allow("other", 50)).toBe(true);
    now = 60_000;
    expect(allow("ws", 50)).toBe(true);
  });
});
