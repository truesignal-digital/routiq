import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveOperatorContext } from "../auth/context.js";
import type { OperatorContext } from "../auth/types.js";
import { platformDb, type PlatformDb } from "../db/platform.js";
import { auditEvents, commands, memberships, principals } from "../db/schema.js";
import { apiClient, seedActor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import { dispatchCommand } from "./dispatcher.js";
import "../server.js";

/**
 * The vendor path to a workspace's first DIRECTOR (ADR-0009): the role
 * migration promotes nobody and no tenant role may grant Direction.
 */
describe("appoint-director.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let platform: PlatformDb;
  let operator: OperatorContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    platform = platformDb(ctx.db);
    const [row] = await ctx.db
      .insert(principals)
      .values({ principalType: "VENDOR_OPERATOR", displayName: "vendor-cli" })
      .returning();
    operator = (await resolveOperatorContext(ctx.db, row!.id))!;
  });

  afterAll(async () => {
    await ctx.close();
  });

  function appoint(workspaceSlug: string, username: string, idempotencyKey = `appoint-${randomUUID()}`) {
    return dispatchCommand(platform, operator, {
      name: "appoint-director",
      version: 1,
      envelope: { commandId: randomUUID(), idempotencyKey, origin: "API" },
      payload: { workspaceSlug, username },
    });
  }

  async function seedAdmin() {
    const seeded = await seedWorkspace(ctx.db);
    const username = `chef-${randomUUID().slice(0, 6)}`;
    const admin = await seedMember(ctx.db, {
      workspaceId: seeded.workspace.id,
      role: "ADMIN",
      branchIds: [seeded.branch.id],
      username,
      pin: "4821",
    });
    return { seeded, admin, username };
  }

  it("makes an existing member DIRECTOR of every branch, with a receipt and a platform audit event", async () => {
    const { seeded, admin, username } = await seedAdmin();
    const result = await appoint(seeded.workspace.slug, username);
    expect(result.status).toBe(200);

    const [row] = await ctx.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.workspaceId, seeded.workspace.id), eq(memberships.principalId, admin.principal.id)));
    expect(row).toMatchObject({ role: "DIRECTOR", allBranches: true, branchIds: [] });

    const body = result.body as { commandId: string };
    const [receipt] = await ctx.db.select().from(commands).where(eq(commands.id, body.commandId));
    expect(receipt).toMatchObject({ scope: "PLATFORM", commandType: "appoint-director", workspaceId: seeded.workspace.id });
    const [event] = await ctx.db.select().from(auditEvents).where(eq(auditEvents.commandId, body.commandId));
    expect(event).toMatchObject({
      scope: "PLATFORM",
      eventType: "member.director-appointed",
      actorPrincipalId: operator.principalId,
      beforeState: { role: "ADMIN", branchScope: [seeded.branch.id] },
      afterState: { role: "DIRECTOR", branchScope: "ALL" },
    });
  });

  it("gives the new DIRECTOR the settings the ADMIN role no longer has", async () => {
    const { seeded, admin, username } = await seedAdmin();
    const api = apiClient(ctx.app);
    const { createSession } = await import("../auth/local.js");
    const { token } = await createSession(ctx.db, { workspaceId: seeded.workspace.id, principalId: admin.principal.id });
    const branch = { branchId: randomUUID(), code: "BAF", name: "Bafoussam" };

    expect((await api.send(token, "create-branch", branch)).body.error?.code).toBe("ROLE_FORBIDDEN");
    expect((await appoint(seeded.workspace.slug, username)).status).toBe(200);
    expect((await api.send(token, "create-branch", branch)).status).toBe(200);
  });

  it("replays under the same key and refuses a second appointment of a DIRECTOR", async () => {
    const { seeded, username } = await seedAdmin();
    const key = `appoint-${randomUUID()}`;
    expect((await appoint(seeded.workspace.slug, username, key)).status).toBe(200);
    const replay = await appoint(seeded.workspace.slug, username, key);
    expect(replay.body).toMatchObject({ idempotentReplay: true });
    const again = await appoint(seeded.workspace.slug, username);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: { code: "INVALID_STATE_TRANSITION" } });
  });

  it("names an unknown workspace or member as such", async () => {
    const { seeded } = await seedAdmin();
    expect((await appoint(`missing-${randomUUID().slice(0, 6)}`, "x")).body).toMatchObject({
      error: { code: "REFERENCE_NOT_FOUND", metadata: { referenceType: "workspace" } },
    });
    expect((await appoint(seeded.workspace.slug, "nobody")).body).toMatchObject({
      error: { code: "REFERENCE_NOT_FOUND", metadata: { referenceType: "member" } },
    });
  });

  it("is not reachable by any tenant role", async () => {
    const seeded = await seedWorkspace(ctx.db);
    const director = await seedActor(ctx.db, { workspaceId: seeded.workspace.id, role: "DIRECTOR" });
    const reply = await apiClient(ctx.app).send(director.token, "appoint-director", {
      workspaceSlug: seeded.workspace.slug,
      username: "anyone",
    });
    expect(reply.status).toBe(403);
    expect(reply.body.error?.code).toBe("COMMAND_SCOPE_FORBIDDEN");
  });
});
