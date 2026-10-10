import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvents, branches, memberships, personLogins, persons } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedWorkspace } from "../test/seed.js";
import { setModule } from "../test/vendor.js";

/**
 * #569: a Person gets their login through link-person-login, relinks through
 * the same command, and loses it through unlink-person-login (ADR-0010). Every
 * link stays on record in person_logins; persons.membership_id is the current
 * one, which the driver's own-trip rule reads.
 */
describe("link-person-login.v1 and unlink-person-login.v1 (#569)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let douala: string;
  let director: Actor;
  let admin: Actor;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    douala = seeded.branch.id;
    director = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN", branchIds: [douala] });
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function person(displayName: string, branchCode = "DLA"): Promise<string> {
    const personId = randomUUID();
    await api.ok(director.token, "register-person", {
      personId,
      displayName,
      branchCode,
      defaultRole: "DRIVER",
    });
    return personId;
  }

  function driverLogin(): Promise<Actor> {
    return seedActor(ctx.db, { workspaceId, role: "DRIVER", branchIds: [douala] });
  }

  async function personRow(personId: string) {
    const [row] = await ctx.db.select().from(persons).where(eq(persons.id, personId));
    if (!row) throw new Error("person not found");
    return row;
  }

  function linksOf(personId: string) {
    return ctx.db
      .select()
      .from(personLogins)
      .where(eq(personLogins.personId, personId))
      .orderBy(asc(personLogins.createdAt), asc(personLogins.id));
  }

  const link = (token: string, personId: string, principalId: string, expectedVersion?: number) =>
    api.send(
      token,
      "link-person-login",
      { personId, principalId },
      expectedVersion === undefined ? {} : { expectedVersion },
    );

  const unlink = (token: string, personId: string, expectedVersion?: number) =>
    api.send(
      token,
      "unlink-person-login",
      { personId },
      expectedVersion === undefined ? {} : { expectedVersion },
    );

  it("links a driver to their login, keeping the link on record and in the audit", async () => {
    const personId = await person("Sali Ngono");
    const login = await driverLogin();

    const reply = await link(admin.token, personId, login.principalId, 1);

    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ recordId: personId, rowVersion: 2 });
    expect(await personRow(personId)).toMatchObject({
      membershipId: login.membershipId,
      rowVersion: 2,
    });
    const links = await linksOf(personId);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      workspaceId,
      membershipId: login.membershipId,
      createdByCommandId: reply.body.commandId,
      endedAt: null,
      endedByCommandId: null,
    });

    const [event] = await ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.commandId, reply.body.commandId!), eq(auditEvents.entityId, personId)));
    expect(event).toMatchObject({
      eventType: "person.login-linked",
      entityType: "person",
      beforeState: { membershipId: null, principalId: null, rowVersion: 1 },
      afterState: { membershipId: login.membershipId, principalId: login.principalId, rowVersion: 2 },
      changedFields: ["membershipId"],
    });
  });

  it("names the linked login on the people list, for the screen's Login column", async () => {
    const personId = await person("Brice Tchana");
    const login = await driverLogin();
    const loginOf = async () => {
      const response = await api.get(admin.token, "/v1/persons");
      expect(response.status).toBe(200);
      const items = (response.body as { items: Array<{ id: string; loginPrincipalId: string | null; rowVersion: number }> }).items;
      return items.find((item) => item.id === personId);
    };
    expect(await loginOf()).toMatchObject({ loginPrincipalId: null, rowVersion: 1 });

    await api.ok(admin.token, "link-person-login", { personId, principalId: login.principalId }, { expectedVersion: 1 });

    expect(await loginOf()).toMatchObject({ loginPrincipalId: login.principalId, rowVersion: 2 });
  });

  it("asks for the person's version, and refuses a stale one", async () => {
    const personId = await person("Jean Mbarga");
    const login = await driverLogin();

    const missing = await link(admin.token, personId, login.principalId);
    expect(missing.status).toBe(400);
    expect(missing.body.error?.code).toBe("EXPECTED_VERSION_REQUIRED");

    const stale = await link(admin.token, personId, login.principalId, 7);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: "VERSION_CONFLICT" });
    expect((await personRow(personId)).membershipId).toBeNull();
  });

  it("is refused to every role but Direction and the Administrateur", async () => {
    const personId = await person("Awa Bello");
    const login = await driverLogin();
    for (const role of ["FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"] as const) {
      const actor = await seedActor(ctx.db, { workspaceId, role });
      const linked = await link(actor.token, personId, login.principalId, 1);
      expect(linked.status, role).toBe(403);
      expect(linked.body.error?.code, role).toBe("ROLE_FORBIDDEN");
      const unlinked = await unlink(actor.token, personId, 1);
      expect(unlinked.status, role).toBe(403);
      expect(unlinked.body.error?.code, role).toBe("ROLE_FORBIDDEN");
    }
    expect((await personRow(personId)).membershipId).toBeNull();
  });

  it("refuses a login another person already holds: one login, one person", async () => {
    const first = await person("Paul Etoundi");
    const second = await person("Paul Etoundi (doublon)");
    const login = await driverLogin();
    await api.ok(admin.token, "link-person-login", { personId: first, principalId: login.principalId }, { expectedVersion: 1 });

    const reply = await link(admin.token, second, login.principalId, 1);

    expect(reply.status).toBe(409);
    expect(reply.body.error).toMatchObject({
      code: "LOGIN_ALREADY_LINKED",
      metadata: { personId: first },
    });
    expect((await personRow(second)).membershipId).toBeNull();
  });

  it("refuses a person or a login of another workspace", async () => {
    const other = await seedWorkspace(ctx.db);
    const otherDirector = await seedActor(ctx.db, { workspaceId: other.workspace.id, role: "DIRECTOR" });
    const otherLogin = await seedActor(ctx.db, { workspaceId: other.workspace.id, role: "DRIVER" });
    const otherPersonId = randomUUID();
    await api.ok(otherDirector.token, "register-person", {
      personId: otherPersonId,
      displayName: "Ailleurs",
      branchCode: "DLA",
    });
    const ownPerson = await person("Chez nous");
    const ownLogin = await driverLogin();

    const foreignLogin = await link(director.token, ownPerson, otherLogin.principalId, 1);
    expect(foreignLogin.status).toBe(422);
    expect(foreignLogin.body.error).toMatchObject({
      code: "REFERENCE_NOT_FOUND",
      metadata: { referenceType: "member" },
    });

    const foreignPerson = await link(director.token, otherPersonId, ownLogin.principalId, 1);
    expect(foreignPerson.status).toBe(422);
    expect(foreignPerson.body.error).toMatchObject({
      code: "REFERENCE_NOT_FOUND",
      metadata: { referenceType: "person" },
    });

    expect((await personRow(ownPerson)).membershipId).toBeNull();
    expect((await personRow(otherPersonId)).membershipId).toBeNull();
  });

  it("holds the Administrateur to the logins it may manage and the people of its branches", async () => {
    const [yaounde] = await ctx.db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();
    const financeLogin = await seedActor(ctx.db, { workspaceId, role: "FINANCE" });
    const personId = await person("Clarisse Fouda");

    const notGrantable = await link(admin.token, personId, financeLogin.principalId, 1);
    expect(notGrantable.status).toBe(403);
    expect(notGrantable.body.error?.code).toBe("MEMBER_ROLE_NOT_GRANTABLE");

    const yaoundePerson = await person("Hervé Ndongo", "YDE");
    const login = await driverLogin();
    const outsideBranch = await link(admin.token, yaoundePerson, login.principalId, 1);
    expect(outsideBranch.status).toBe(403);
    expect(outsideBranch.body.error?.code).toBe("ROLE_FORBIDDEN");

    // Direction links anyone, in any branch.
    expect((await link(director.token, yaoundePerson, financeLogin.principalId, 1)).status).toBe(200);
    expect(yaounde).toBeDefined();
  });

  it("refuses a deactivated login", async () => {
    const personId = await person("Ancien Chauffeur");
    const login = await driverLogin();
    await ctx.db
      .update(memberships)
      .set({ deactivatedAt: new Date() })
      .where(eq(memberships.id, login.membershipId));

    const reply = await link(admin.token, personId, login.principalId, 1);

    expect(reply.status).toBe(422);
    expect(reply.body.error).toMatchObject({
      code: "REFERENCE_NOT_FOUND",
      metadata: { referenceType: "member", reason: "deactivated" },
    });
  });

  it("relinks to another login by ending the current link, never rewriting it", async () => {
    const personId = await person("Moussa Bello");
    const oldLogin = await driverLogin();
    const newLogin = await driverLogin();
    const first = await api.ok(admin.token, "link-person-login", { personId, principalId: oldLogin.principalId }, { expectedVersion: 1 });

    const same = await link(admin.token, personId, oldLogin.principalId, 2);
    expect(same.status).toBe(409);
    expect(same.body.error?.code).toBe("INVALID_STATE_TRANSITION");

    const relinked = await link(admin.token, personId, newLogin.principalId, 2);

    expect(relinked.status).toBe(200);
    expect(relinked.body.rowVersion).toBe(3);
    expect((await personRow(personId)).membershipId).toBe(newLogin.membershipId);
    const links = await linksOf(personId);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({
      membershipId: oldLogin.membershipId,
      createdByCommandId: first.commandId,
      endedByCommandId: relinked.body.commandId,
    });
    expect(links[0]?.endedAt).toBeInstanceOf(Date);
    expect(links[1]).toMatchObject({ membershipId: newLogin.membershipId, endedAt: null });

    const [event] = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.commandId, relinked.body.commandId!));
    expect(event).toMatchObject({
      eventType: "person.login-relinked",
      beforeState: { membershipId: oldLogin.membershipId, principalId: oldLogin.principalId },
      afterState: { membershipId: newLogin.membershipId, principalId: newLogin.principalId },
    });

    // The old login is free again for someone else.
    const other = await person("Quelqu'un d'autre");
    expect((await link(admin.token, other, oldLogin.principalId, 1)).status).toBe(200);
  });

  it("unlinks by ending the current link, and refuses a person with none", async () => {
    const personId = await person("Esther Abena");
    const login = await driverLogin();
    await api.ok(admin.token, "link-person-login", { personId, principalId: login.principalId }, { expectedVersion: 1 });

    const missingVersion = await unlink(admin.token, personId);
    expect(missingVersion.status).toBe(400);
    expect(missingVersion.body.error?.code).toBe("EXPECTED_VERSION_REQUIRED");

    const reply = await unlink(admin.token, personId, 2);

    expect(reply.status).toBe(200);
    expect(reply.body.rowVersion).toBe(3);
    expect(await personRow(personId)).toMatchObject({ membershipId: null, active: true });
    const links = await linksOf(personId);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      membershipId: login.membershipId,
      endedByCommandId: reply.body.commandId,
    });

    const [event] = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.commandId, reply.body.commandId!));
    expect(event).toMatchObject({
      eventType: "person.login-unlinked",
      beforeState: { membershipId: login.membershipId, principalId: login.principalId },
      afterState: { membershipId: null, principalId: null },
    });

    const again = await unlink(admin.token, personId, 3);
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe("INVALID_STATE_TRANSITION");
  });

  it("refuses the Administrateur unlinking a login it may not manage", async () => {
    const personId = await person("Comptable Terrain");
    const financeLogin = await seedActor(ctx.db, { workspaceId, role: "FINANCE" });
    await api.ok(director.token, "link-person-login", { personId, principalId: financeLogin.principalId }, { expectedVersion: 1 });

    const reply = await unlink(admin.token, personId, 2);

    expect(reply.status).toBe(403);
    expect(reply.body.error?.code).toBe("MEMBER_ROLE_NOT_GRANTABLE");
  });
});

/**
 * The reason the link exists: ADR-0012's own-trip rule reads the caller's
 * Person through persons.membership_id. A trip the office planned for Sali is
 * hers only once her Person is linked to her login, and stops being hers when
 * the link ends.
 */
describe("a linked driver reads the trips planned for their person (#569)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("shows the planned trip after linking and hides it after unlinking", async () => {
    const seeded = await seedWorkspace(ctx.db);
    const workspaceId = seeded.workspace.id;
    await setModule(ctx.db, workspaceId, "SCHEDULING", true);
    const admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    const sali = await seedActor(ctx.db, { workspaceId, role: "DRIVER", branchIds: [seeded.branch.id] });
    const personId = randomUUID();
    await api.ok(admin.token, "register-person", {
      personId,
      displayName: "Sali Ngono",
      branchCode: "DLA",
      defaultRole: "DRIVER",
    });
    const tripId = randomUUID();
    await api.ok(admin.token, "plan-trip", {
      activityId: tripId,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      plannedStartAt: "2026-10-12T07:00:00+01:00",
      plannedDriverPersonId: personId,
    });

    const tripIds = async () => {
      const response = await api.get(sali.token, "/v1/activities?status=PLANNED&limit=100");
      expect(response.status).toBe(200);
      return (response.body as { items: Array<{ id: string }> }).items.map((item) => item.id);
    };

    expect(await tripIds()).not.toContain(tripId);

    await api.ok(admin.token, "link-person-login", { personId, principalId: sali.principalId }, { expectedVersion: 1 });
    expect(await tripIds()).toContain(tripId);
    expect((await api.get(sali.token, `/v1/activities/${tripId}`)).status).toBe(200);

    await api.ok(admin.token, "unlink-person-login", { personId }, { expectedVersion: 2 });
    expect(await tripIds()).not.toContain(tripId);
  });
});
