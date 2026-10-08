import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { auditEvents, branches, noteAcknowledgements, notes } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

/**
 * Direction's notes in the vehicle To-do (#98): a note from DIRECTOR shows for
 * everyone who can see the vehicle until someone other than its author
 * acknowledges it; the acknowledgement is its own append-only record.
 */
describe("Direction notes and acknowledge-note.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let directorToken: string;
  let otherDirectorToken: string;
  let adminToken: string;
  let adminMembershipId: string;
  let driverToken: string;
  let cashierToken: string;
  let yaoundeDriverToken: string;
  let assetId: string;

  type SeedRole = "DIRECTOR" | "ADMIN" | "DRIVER" | "CASHIER";

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;
    const [yaounde] = await db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();

    const member = async (
      role: SeedRole,
      scope: { allBranches: true } | { branchIds: string[] } = { branchIds: [seeded.branch.id] },
    ) => {
      const seededMember = await seedMember(db, { workspaceId, role, ...scope });
      const token = (await createSession(db, { workspaceId, principalId: seededMember.principal.id })).token;
      return { token, membershipId: seededMember.membership.id };
    };
    directorToken = (await member("DIRECTOR", { allBranches: true })).token;
    otherDirectorToken = (await member("DIRECTOR", { allBranches: true })).token;
    const admin = await member("ADMIN");
    adminToken = admin.token;
    adminMembershipId = admin.membershipId;
    driverToken = (await member("DRIVER")).token;
    cashierToken = (await member("CASHIER")).token;
    yaoundeDriverToken = (await member("DRIVER", { branchIds: [yaounde!.id] })).token;
    assetId = await seedAsset(ctx.app, directorToken);
  });

  afterAll(async () => {
    await ctx.close();
  });

  function post(token: string, name: string, payload: Record<string, unknown>) {
    return ctx.app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        envelope: { commandId: randomUUID(), idempotencyKey: `idem-${randomUUID()}`, origin: "HUMAN_UI" },
        payload,
      },
    });
  }

  const get = (token: string, url: string) =>
    ctx.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });

  async function addNote(token: string, body = "Pourquoi cette réparation coûte-t-elle si cher ?") {
    const noteId = randomUUID();
    const response = await post(token, "add-note", { noteId, entityType: "asset", entityId: assetId, body });
    expect(response.statusCode).toBe(200);
    return noteId;
  }

  const acknowledge = (token: string, noteId: string) => post(token, "acknowledge-note", { noteId });

  async function todoNotes(token: string): Promise<Array<{ subject: { id: string }; params: Record<string, unknown>; makerPrincipalIds: string[] }>> {
    const response = await get(token, `/v1/assets/${assetId}/attention`);
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: Array<{ code: string; subject: { id: string }; params: Record<string, unknown>; makerPrincipalIds: string[] }> }).items.filter(
      (item) => item.code === "DIRECTION_NOTE",
    );
  }

  it("stores the author's role with the note", async () => {
    const fromDirection = await addNote(directorToken);
    const fromAdmin = await addNote(adminToken, "Pneu avant à surveiller");
    const rows = await db.select({ id: notes.id, authorRole: notes.authorRole }).from(notes);
    expect(rows.find((row) => row.id === fromDirection)?.authorRole).toBe("DIRECTOR");
    expect(rows.find((row) => row.id === fromAdmin)?.authorRole).toBe("ADMIN");
  });

  it("puts a Direction note in the To-do of everyone who can see the vehicle, and only Direction's", async () => {
    const fromDirection = await addNote(directorToken, "Appelez-moi avant de payer le garage");
    const fromAdmin = await addNote(adminToken, "Note d'atelier");
    for (const token of [directorToken, adminToken, driverToken, cashierToken]) {
      const ids = (await todoNotes(token)).map((item) => item.subject.id);
      expect(ids).toContain(fromDirection);
      expect(ids).not.toContain(fromAdmin);
    }
    const item = (await todoNotes(driverToken)).find((entry) => entry.subject.id === fromDirection);
    expect(item?.params).toMatchObject({
      description: "Appelez-moi avant de payer le garage",
      recordedBy: { scope: "WORKSPACE" },
    });
    expect(item?.makerPrincipalIds).toHaveLength(1);
  });

  it("keeps a driver outside the vehicle's branch from ever seeing the note", async () => {
    const noteId = await addNote(directorToken, "Visible à Douala seulement");
    expect((await get(yaoundeDriverToken, `/v1/assets/${assetId}/attention`)).statusCode).toBe(404);
    expect((await get(yaoundeDriverToken, `/v1/notes/${noteId}`)).statusCode).toBe(404);
    const refused = await acknowledge(yaoundeDriverToken, noteId);
    expect(refused.statusCode).toBe(403);
    expect(await db.select().from(noteAcknowledgements).where(eq(noteAcknowledgements.noteId, noteId))).toHaveLength(0);
  });

  it("records who acknowledged it and when, takes it out of the To-do, and leaves the note untouched", async () => {
    const noteId = await addNote(directorToken, "Vérifiez la facture des freins");
    const [before] = await db.select().from(notes).where(eq(notes.id, noteId));

    const response = await acknowledge(adminToken, noteId);
    expect(response.statusCode).toBe(200);

    const rows = await db.select().from(noteAcknowledgements).where(eq(noteAcknowledgements.noteId, noteId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ membershipId: adminMembershipId });
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
    expect((await db.select().from(notes).where(eq(notes.id, noteId)))[0]).toEqual(before);

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, noteId), eq(auditEvents.eventType, "note.acknowledged")));
    expect(event).toMatchObject({ entityType: "note" });

    for (const token of [directorToken, adminToken, driverToken]) {
      expect((await todoNotes(token)).map((item) => item.subject.id)).not.toContain(noteId);
    }

    const detail = await get(driverToken, `/v1/notes/${noteId}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      id: noteId,
      body: "Vérifiez la facture des freins",
      authorRole: "DIRECTOR",
      acknowledgement: { by: { scope: "WORKSPACE" }, at: rows[0]!.createdAt.toISOString() },
    });
  });

  it("keeps the first acknowledgement when a second member says seen too", async () => {
    const noteId = await addNote(directorToken, "Deux personnes l'ont lue");
    expect((await acknowledge(adminToken, noteId)).statusCode).toBe(200);
    const again = await acknowledge(driverToken, noteId);
    expect(again.statusCode).toBe(200);
    const rows = await db.select().from(noteAcknowledgements).where(eq(noteAcknowledgements.noteId, noteId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.membershipId).toBe(adminMembershipId);
    const events = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, noteId), eq(auditEvents.eventType, "note.acknowledged")));
    expect(events).toHaveLength(1);
  });

  it("refuses the note's author, but lets another Direction member acknowledge", async () => {
    const noteId = await addNote(directorToken, "Ma propre note");
    const own = await acknowledge(directorToken, noteId);
    expect(own.statusCode).toBe(403);
    expect(own.json()).toMatchObject({ error: { code: "NOTE_AUTHOR_CANNOT_ACKNOWLEDGE" } });
    expect((await acknowledge(otherDirectorToken, noteId)).statusCode).toBe(200);
  });

  it("refuses a note that is not Direction's", async () => {
    const noteId = await addNote(adminToken, "Note de l'administrateur");
    const response = await acknowledge(driverToken, noteId);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "NOTE_NOT_FROM_DIRECTION" } });
  });

  it("answers an unknown note with REFERENCE_NOT_FOUND", async () => {
    const response = await acknowledge(adminToken, randomUUID());
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: "REFERENCE_NOT_FOUND" } });
  });
});
