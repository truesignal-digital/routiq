import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "./local.js";
import { credentials } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

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
      enabledModules: ["CORE", "ASSETS", "DOCUMENTS", "FINANCE", "ACTIVITIES"],
    });
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
