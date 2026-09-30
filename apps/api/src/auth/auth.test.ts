import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { createSession } from "./local.js";
import { resolveOperatorContext } from "./context.js";
import { dispatchCommand } from "../commands/dispatcher.js";
import { credentials, principals } from "../db/schema.js";
import { platformDb } from "../db/platform.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import * as schema from "../db/schema.js";
import { buildServer } from "../server.js";
import "../server.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let ws: Awaited<ReturnType<typeof seedWorkspace>>;

beforeAll(async () => {
  ctx = await createTestApp();
  ws = await seedWorkspace(ctx.db);
});

afterAll(async () => {
  await ctx.close();
});

async function login(body: unknown) {
  return ctx.app.inject({ method: "POST", url: "/v1/auth/login", payload: body as object });
}

describe("username/PIN login", () => {
  it("issues a token for a provisioned field user and /v1/me resolves the full context", async () => {
    const member = await seedMember(ctx.db, {
      workspaceId: ws.workspace.id,
      role: "FIELD_SUBMITTER",
      branchIds: [ws.branch.id],
      username: "clerk1",
      pin: "4821",
    });

    const res = await login({ workspaceSlug: ws.workspace.slug, username: "clerk1", pin: "4821" });
    expect(res.statusCode).toBe(200);
    const { token } = res.json();
    expect(typeof token).toBe("string");

    const me = await ctx.app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({
      workspaceId: ws.workspace.id,
      principalId: member.principal.id,
      principalType: "HUMAN",
      membershipId: member.membership.id,
      role: "FIELD_SUBMITTER",
      branchScope: [ws.branch.id],
      enabledModules: [
        "CORE",
        "ASSETS",
        "DOCUMENTS",
        "FINANCE",
        "ACTIVITIES",
        "MAINTENANCE",
      ],
      // Seeded workspaces have no workspace_templates rows, so they are
      // grandfathered all-enabled exactly as the dispatcher treats them.
      enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"],
    });
  });

  /**
   * The set the web shapes its UI around, so it is worth proving against a
   * workspace that was really provisioned rather than one with hand-inserted
   * rows: a single-preset tenant must not be told the other preset exists.
   */
  it("/v1/me returns only the presets a provisioned workspace enabled", async () => {
    const slug = `tenant-${randomUUID().slice(0, 8)}`;
    const [vendor] = await ctx.db
      .insert(principals)
      .values({ principalType: "VENDOR_OPERATOR", displayName: "vendor-cli" })
      .returning();
    if (!vendor) throw new Error("operator principal insert returned no row");
    const operator = await resolveOperatorContext(ctx.db, vendor.id);
    if (!operator) throw new Error("operator context did not resolve");

    const provisioned = await dispatchCommand(platformDb(ctx.db), operator, {
      name: "provision-workspace",
      version: 2,
      envelope: {
        commandId: randomUUID(),
        idempotencyKey: `idem-${randomUUID()}`,
        origin: "API",
      },
      payload: {
        workspace: { id: randomUUID(), slug, name: `Transports ${slug}` },
        branches: [{ id: randomUUID(), code: "DLA", name: "Douala" }],
        admin: {
          id: randomUUID(),
          displayName: "Awa Ndongo",
          username: "boss",
          pin: "482913",
        },
        enabledPresets: ["TRUCKING"],
      },
    });
    expect(provisioned.status).toBe(200);

    const res = await login({ workspaceSlug: slug, username: "boss", pin: "482913" });
    expect(res.statusCode).toBe(200);

    const me = await ctx.app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${res.json().token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().enabledPresets).toEqual(["TRUCKING"]);
  });

  it("rejects a wrong PIN with a stable code and no message text", async () => {
    await seedMember(ctx.db, {
      workspaceId: ws.workspace.id,
      role: "FIELD_SUBMITTER",
      branchIds: [ws.branch.id],
      username: "clerk2",
      pin: "1111",
    });

    const res = await login({ workspaceSlug: ws.workspace.slug, username: "clerk2", pin: "9999" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: "AUTH_INVALID_CREDENTIALS" } });
  });

  it("rejects an unknown username with the same code (no user-exists oracle)", async () => {
    const res = await login({ workspaceSlug: ws.workspace.slug, username: "ghost", pin: "0000" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: "AUTH_INVALID_CREDENTIALS" } });
  });

  it("locks the credential after 5 wrong PINs and unlocks after the window", async () => {
    await seedMember(ctx.db, {
      workspaceId: ws.workspace.id,
      role: "FIELD_SUBMITTER",
      branchIds: [ws.branch.id],
      username: "clerk3",
      pin: "2468",
    });
    const attempt = (pin: string) =>
      login({ workspaceSlug: ws.workspace.slug, username: "clerk3", pin });

    for (let i = 0; i < 5; i++) {
      expect((await attempt("0000")).json().error.code).toBe("AUTH_INVALID_CREDENTIALS");
    }

    const locked = await attempt("2468");
    expect(locked.statusCode).toBe(401);
    const lockedBody = locked.json();
    expect(lockedBody.error.code).toBe("AUTH_LOCKED");
    expect(lockedBody.error.metadata.retryAfterSeconds).toBeGreaterThan(0);

    await ctx.db
      .update(credentials)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(credentials.username, "clerk3"));

    const afterExpiry = await attempt("2468");
    expect(afterExpiry.statusCode).toBe(200);

    const [cred] = await ctx.db
      .select()
      .from(credentials)
      .where(eq(credentials.username, "clerk3"));
    expect(cred?.failedAttempts).toBe(0);
    expect(cred?.lockedUntil).toBeNull();
  });

  it("a correct login resets the failed-attempt counter", async () => {
    await seedMember(ctx.db, {
      workspaceId: ws.workspace.id,
      role: "FIELD_SUBMITTER",
      branchIds: [ws.branch.id],
      username: "clerk4",
      pin: "1357",
    });
    const attempt = (pin: string) =>
      login({ workspaceSlug: ws.workspace.slug, username: "clerk4", pin });

    await attempt("0000");
    await attempt("0000");
    expect((await attempt("1357")).statusCode).toBe(200);

    const [cred] = await ctx.db
      .select()
      .from(credentials)
      .where(eq(credentials.username, "clerk4"));
    expect(cred?.failedAttempts).toBe(0);
  });

  it("locks login after five simultaneous incorrect PIN attempts", async () => {
    await seedMember(ctx.db, {
      workspaceId: ws.workspace.id,
      role: "FIELD_SUBMITTER",
      branchIds: [ws.branch.id],
      username: "concurrent-pin",
      pin: "246810",
    });
    const attempt = (pin: string) =>
      login({ workspaceSlug: ws.workspace.slug, username: "concurrent-pin", pin });

    const failures = await Promise.all(
      Array.from({ length: 5 }, () => attempt("000000")),
    );
    expect(failures.every((response) => response.statusCode === 401)).toBe(true);

    const correctPin = await attempt("246810");
    expect(correctPin.statusCode).toBe(401);
    expect(correctPin.json().error.code).toBe("AUTH_LOCKED");
  });

  it("keeps a concurrent lock for fifteen minutes without extending it on more attempts", async () => {
    await seedMember(ctx.db, {
      workspaceId: ws.workspace.id,
      role: "FIELD_SUBMITTER",
      branchIds: [ws.branch.id],
      username: "concurrent-pin-expiry",
      pin: "246810",
    });
    const attempt = (pin: string) =>
      login({ workspaceSlug: ws.workspace.slug, username: "concurrent-pin-expiry", pin });
    const start = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    try {
      const failures = await Promise.all(
        Array.from({ length: 10 }, () => attempt("000000")),
      );
      expect(failures.every((response) => response.statusCode === 401)).toBe(true);
      expect((await attempt("246810")).json()).toEqual({
        error: { code: "AUTH_LOCKED", metadata: { retryAfterSeconds: 900 } },
      });

      clock.mockReturnValue(start + 899_000);
      expect((await attempt("000000")).json()).toEqual({
        error: { code: "AUTH_LOCKED", metadata: { retryAfterSeconds: 1 } },
      });
      expect((await attempt("246810")).json().error.code).toBe("AUTH_LOCKED");

      clock.mockReturnValue(start + 900_000);
      expect((await attempt("246810")).statusCode).toBe(200);
    } finally {
      clock.mockRestore();
    }
  });

  it("does not let an in-flight correct PIN clear a lock established by the fifth failure", async () => {
    await seedMember(ctx.db, {
      workspaceId: ws.workspace.id,
      role: "FIELD_SUBMITTER",
      branchIds: [ws.branch.id],
      username: "in-flight-pin",
      pin: "246810",
    });
    // The named connection pool lets the test arrange the database interleaving
    // without mocking PIN verification or login internals. The verdict is HTTP.
    const applicationName = `pin-lock-test-${randomUUID()}`;
    const authPool = new pg.Pool({
      connectionString: inject("databaseUrl"),
      application_name: applicationName,
    });
    const app = buildServer({
      db: ctx.runtimeDb,
      authDb: drizzle(authPool, { schema }),
      logger: false,
    });
    await app.ready();
    const attempt = (pin: string) => app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { workspaceSlug: ws.workspace.slug, username: "in-flight-pin", pin },
    }).then((response) => response);

    const waitForBlockedRequests = (count: number) => vi.waitFor(async () => {
      const result = await ctx.db.execute(sql`
        SELECT count(*)::integer AS count FROM pg_stat_activity
        WHERE application_name = ${applicationName} AND wait_event_type = 'Lock'
      `);
      expect(result.rows[0]?.count).toBe(count);
    }, { timeout: 5000, interval: 10 });

    try {
      for (let i = 0; i < 4; i++) expect((await attempt("000000")).statusCode).toBe(401);
      const pending = await ctx.db.transaction(async (tx) => {
        await tx.select().from(credentials)
          .where(eq(credentials.username, "in-flight-pin")).for("update");
        const fifthFailure = attempt("000000");
        await waitForBlockedRequests(1);
        const correctPin = attempt("246810");
        await waitForBlockedRequests(2);
        return { fifthFailure, correctPin };
      });

      expect((await pending.fifthFailure).statusCode).toBe(401);
      const correctPin = await pending.correctPin;
      expect(correctPin.statusCode).toBe(401);
      expect(correctPin.json().error.code).toBe("AUTH_LOCKED");
    } finally {
      await app.close();
      await authPool.end();
    }
  });
});

describe("protected surfaces", () => {
  it.each(["/v1/me", "/v1/commands"])("%s without a token → AUTH_REQUIRED", async (url) => {
    const res = await ctx.app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: "AUTH_REQUIRED" } });
  });

  it("rejects a garbage token with AUTH_INVALID_TOKEN", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: "AUTH_INVALID_TOKEN" } });
  });

  it("rejects an expired session", async () => {
    const member = await seedMember(ctx.db, {
      workspaceId: ws.workspace.id,
      role: "OPS_MANAGER",
      allBranches: true,
    });
    const { token } = await createSession(ctx.db, {
      principalId: member.principal.id,
      workspaceId: ws.workspace.id,
      ttlMs: -1000,
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: "AUTH_INVALID_TOKEN" } });
  });
});

describe("server-derived identity", () => {
  it("ignores client-supplied tenant/actor headers — context comes from the session", async () => {
    const other = await seedWorkspace(ctx.db);
    const member = await seedMember(ctx.db, {
      workspaceId: ws.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    const { token } = await createSession(ctx.db, {
      principalId: member.principal.id,
      workspaceId: ws.workspace.id,
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/me",
      headers: {
        authorization: `Bearer ${token}`,
        "x-workspace-id": other.workspace.id,
        "x-principal-id": "00000000-0000-0000-0000-000000000000",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      workspaceId: ws.workspace.id,
      principalId: member.principal.id,
      branchScope: "ALL",
    });
  });

  it("resolves an AI_AGENT principal the same as a human (nothing assumes HUMAN)", async () => {
    const agent = await seedMember(ctx.db, {
      workspaceId: ws.workspace.id,
      role: "FIELD_SUBMITTER",
      principalType: "AI_AGENT",
      branchIds: [ws.branch.id],
    });
    const { token } = await createSession(ctx.db, {
      principalId: agent.principal.id,
      workspaceId: ws.workspace.id,
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ principalType: "AI_AGENT", role: "FIELD_SUBMITTER" });
  });
});
