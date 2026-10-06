import { randomUUID } from "node:crypto";
import { historyListResponse } from "@routiq/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assets, auditEvents, branches, notes } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

describe("add-note.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let admin: Actor;
  let driver: Actor;
  let mechanic: Actor;
  let approver: Actor;
  let cashier: Actor;
  let ydeOnly: Actor;
  let assetId: string;
  let otherWorkspaceAssetId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    const workspaceId = seeded.workspace.id;
    const [yaounde] = await ctx.db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();
    if (!yaounde) throw new Error("branch insert returned no row");

    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    driver = await seedActor(ctx.db, { workspaceId, role: "DRIVER", displayName: "Sali" });
    mechanic = await seedActor(ctx.db, { workspaceId, role: "TECHNICIAN" });
    approver = await seedActor(ctx.db, { workspaceId, role: "FINANCE" });
    cashier = await seedActor(ctx.db, { workspaceId, role: "CASHIER" });
    ydeOnly = await seedActor(ctx.db, {
      workspaceId,
      role: "ADMIN",
      branchIds: [yaounde.id],
    });
    assetId = await seedAsset(ctx.app, admin.token, { assetCode: "NOTE-01" });

    const other = await seedWorkspace(ctx.db);
    const otherAdmin = await seedActor(ctx.db, { workspaceId: other.workspace.id, role: "ADMIN" });
    otherWorkspaceAssetId = await seedAsset(ctx.app, otherAdmin.token);
  });

  afterAll(async () => {
    await ctx.close();
  });

  const note = (body: string, target = assetId) => ({
    noteId: randomUUID(),
    entityType: "asset",
    entityId: target,
    body,
  });

  it("appends the note with its author, and audits it", async () => {
    const payload = note("  Rétroviseur droit fissuré  ");
    const result = await api.ok(driver.token, "add-note", payload);
    expect(result).toMatchObject({ recordId: payload.noteId, rowVersion: 1, warnings: [] });

    const [row] = await ctx.db.select().from(notes).where(eq(notes.id, payload.noteId));
    expect(row).toMatchObject({
      entityType: "asset",
      entityId: assetId,
      assetId,
      authorMembershipId: driver.membershipId,
      authorRole: "DRIVER",
      body: "Rétroviseur droit fissuré",
      createdByCommandId: result.commandId,
    });

    const [event] = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.commandId, result.commandId));
    expect(event).toMatchObject({
      eventType: "note.added",
      entityType: "note",
      entityId: payload.noteId,
      actorPrincipalId: driver.principalId,
      afterState: {
        entityType: "asset",
        entityId: assetId,
        authorRole: "DRIVER",
        body: "Rétroviseur droit fissuré",
      },
      changedFields: ["entityType", "entityId", "authorRole", "body"],
    });
  });

  it("is open to every recording role", async () => {
    for (const actor of [admin, mechanic, approver]) {
      expect((await api.send(actor.token, "add-note", note("Vu au dépôt"))).status).toBe(200);
    }
  });

  it("replays an exact retry and refuses the key with a different body", async () => {
    const payload = note("Pare-brise étoilé");
    const envelope = { commandId: randomUUID(), idempotencyKey: `note-${randomUUID()}` };
    const first = await api.ok(driver.token, "add-note", payload, envelope);
    const retry = await api.ok(driver.token, "add-note", payload, envelope);
    expect(retry).toMatchObject({ recordId: first.recordId, idempotentReplay: true });

    const reused = await api.send(driver.token, "add-note", { ...payload, body: "Autre chose" }, envelope);
    expect(reused.status).toBe(409);
    expect(reused.body.error?.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await ctx.db.select().from(notes).where(eq(notes.id, payload.noteId))).toHaveLength(1);
  });

  it("lets every role write a note, the cashier included", async () => {
    const reply = await api.send(cashier.token, "add-note", note("Vu au guichet"));
    expect(reply.status).toBe(200);
  });

  it("refuses a vehicle outside the author's branches", async () => {
    const reply = await api.send(ydeOnly.token, "add-note", note("Hors agence"));
    expect(reply.status).toBe(403);
    expect(reply.body.error?.code).toBe("ROLE_FORBIDDEN");
  });

  it("treats another workspace's vehicle as not found", async () => {
    const reply = await api.send(admin.token, "add-note", note("Ailleurs", otherWorkspaceAssetId));
    expect(reply.status).toBe(422);
    expect(reply.body.error).toMatchObject({
      code: "REFERENCE_NOT_FOUND",
      metadata: { referenceType: "asset" },
    });
  });

  it("refuses an empty or oversized body", async () => {
    for (const body of ["", "   ", "x".repeat(2001)]) {
      const reply = await api.send(driver.token, "add-note", note(body));
      expect(reply.status, JSON.stringify(body.slice(0, 5))).toBe(400);
      expect(reply.body.error?.code).toBe("VALIDATION_FAILED");
    }
  });

  it("refuses a note on a disposed vehicle", async () => {
    const soldId = await seedAsset(ctx.app, admin.token);
    await ctx.db.update(assets).set({ lifecycleStatus: "SOLD" }).where(eq(assets.id, soldId));
    const reply = await api.send(admin.token, "add-note", note("Vendu", soldId));
    expect(reply.status).toBe(409);
    expect(reply.body.error).toMatchObject({
      code: "ASSET_NOT_OPERATIONAL",
      metadata: { assetId: soldId, lifecycleStatus: "SOLD" },
    });
  });

  it("has a record history, scoped by the vehicle's branch", async () => {
    const payload = note("Klaxon faible");
    await api.ok(driver.token, "add-note", payload);

    const history = await api.get(driver.token, `/v1/history/note/${payload.noteId}`);
    expect(history.status).toBe(200);
    expect(historyListResponse.parse(history.body).items).toEqual([
      expect.objectContaining({
        eventType: "note.added",
        actor: { principalId: driver.principalId, displayName: "Sali", scope: "WORKSPACE" },
        command: expect.objectContaining({ name: "add-note" }),
      }),
    ]);

    const hidden = await api.get(ydeOnly.token, `/v1/history/note/${payload.noteId}`);
    expect(hidden.status).toBe(404);
  });
});
