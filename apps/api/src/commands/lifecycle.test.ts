import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inject } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import pg from "pg";
import { createTestApp } from "../test/fixture.js";
import { seedWorkspace, seedMember } from "../test/seed.js";
import { createSession } from "../auth/local.js";
import { assets, auditEvents, branches } from "../db/schema.js";
import type { Db } from "../db/client.js";
import { buildServer } from "../server.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { seedAsset } from "../test/seed.js";

describe("Asset Lifecycle Commands", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let app: Awaited<ReturnType<typeof createTestApp>>["app"];
  let db: Db;
  let workspace: Awaited<ReturnType<typeof seedWorkspace>>["workspace"];
  let branch: Awaited<ReturnType<typeof seedWorkspace>>["branch"];
  let principal: Awaited<ReturnType<typeof seedMember>>["principal"];
  let token: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    db = ctx.db;

    const seeded = await seedWorkspace(db);
    workspace = seeded.workspace;
    branch = seeded.branch;

    const member = await seedMember(db, {
      workspaceId: workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    principal = member.principal;

    const session = await createSession(db, {
      principalId: principal.id,
      workspaceId: workspace.id,
    });
    token = session.token;
  });

  afterAll(async () => {
    await ctx.close();
  });

  const postCommand = async (body: unknown, authToken?: string) => {
    return app.inject({
      method: "POST",
      url: "/v1/commands",
      payload: body as object,
      headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
    });
  };

  describe("commission-asset", () => {
    it("test 1: Register → Commission → Assign happy path", async () => {
      const assetId = randomUUID();
      const commandId1 = randomUUID();
      const idempotencyKey1 = `idem-${randomUUID()}`;

      // Register asset
      const registerRes = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: commandId1,
            idempotencyKey: idempotencyKey1,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
            assetCode: "TRUCK-001",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
        token
      );

      expect(registerRes.statusCode).toBe(200);
      const registerBody = JSON.parse(registerRes.body);
      expect(registerBody.rowVersion).toBe(1);

      // Commission asset with expectedVersion
      const commandId2 = randomUUID();
      const idempotencyKey2 = `idem-${randomUUID()}`;
      const commissionRes = await postCommand(
        {
          name: "commission-asset",
          version: 1,
          envelope: {
            commandId: commandId2,
            idempotencyKey: idempotencyKey2,
            expectedVersion: 1,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
          },
        },
        token
      );

      expect(commissionRes.statusCode).toBe(200);
      const commissionBody = JSON.parse(commissionRes.body);
      expect(commissionBody.rowVersion).toBe(2);

      const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
      expect(asset).toBeDefined();
      expect(asset!.lifecycleStatus).toBe("IN_SERVICE");
      expect(asset!.commissionedAt).toBeDefined();

      // Verify audit event exists
      const auditRows = await db
        .select()
        .from(auditEvents)
        .where(and(
          eq(auditEvents.workspaceId, workspace.id),
          eq(auditEvents.commandId, commandId2)
        ));
      expect(auditRows.length).toBeGreaterThan(0);
      const commissionAudit = auditRows.find(e => e.eventType === "asset.commissioned");
      expect(commissionAudit).toBeDefined();

      // Assign to custodian member
      const member = await seedMember(db, {
        workspaceId: workspace.id,
        role: "OPS_MANAGER",
        allBranches: true,
      });

      const commandId3 = randomUUID();
      const idempotencyKey3 = `idem-${randomUUID()}`;
      const assignRes = await postCommand(
        {
          name: "assign-asset",
          version: 1,
          envelope: {
            commandId: commandId3,
            idempotencyKey: idempotencyKey3,
            expectedVersion: 2,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
            custodianMembershipId: member.membership.id,
          },
        },
        token
      );

      expect(assignRes.statusCode).toBe(200);
      const assignBody = JSON.parse(assignRes.body);
      expect(assignBody.rowVersion).toBe(3);

      const [assetAfterAssign] = await db
        .select()
        .from(assets)
        .where(eq(assets.id, assetId));
      expect(assetAfterAssign).toBeDefined();
      expect(assetAfterAssign!.custodianMembershipId).toBe(member.membership.id);

      const assignAudits = await db
        .select()
        .from(auditEvents)
        .where(and(
          eq(auditEvents.workspaceId, workspace.id),
          eq(auditEvents.commandId, commandId3)
        ));
      expect(assignAudits.some(e => e.eventType === "asset.assigned")).toBe(true);
    });

    it("test 2: Commission without expectedVersion returns 400", async () => {
      const assetId = randomUUID();
      const commandId1 = randomUUID();
      const idempotencyKey1 = `idem-${randomUUID()}`;

      await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: commandId1,
            idempotencyKey: idempotencyKey1,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
            assetCode: "TRUCK-002",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
        token
      );

      const commandId2 = randomUUID();
      const idempotencyKey2 = `idem-${randomUUID()}`;
      const res = await postCommand(
        {
          name: "commission-asset",
          version: 1,
          envelope: {
            commandId: commandId2,
            idempotencyKey: idempotencyKey2,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
          },
        },
        token
      );

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("EXPECTED_VERSION_REQUIRED");
    });

    it("test 3: Commission with stale expectedVersion returns 409", async () => {
      const assetId = randomUUID();
      const commandId1 = randomUUID();
      const idempotencyKey1 = `idem-${randomUUID()}`;

      await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: commandId1,
            idempotencyKey: idempotencyKey1,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
            assetCode: "TRUCK-003",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
        token
      );

      const commandId2 = randomUUID();
      const idempotencyKey2 = `idem-${randomUUID()}`;
      await postCommand(
        {
          name: "commission-asset",
          version: 1,
          envelope: {
            commandId: commandId2,
            idempotencyKey: idempotencyKey2,
            expectedVersion: 1,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
          },
        },
        token
      );

      const commandId3 = randomUUID();
      const idempotencyKey3 = `idem-${randomUUID()}`;
      const res = await postCommand(
        {
          name: "commission-asset",
          version: 1,
          envelope: {
            commandId: commandId3,
            idempotencyKey: idempotencyKey3,
            expectedVersion: 1,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
          },
        },
        token
      );

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("VERSION_CONFLICT");
      expect(body.error.metadata.currentVersion).toBe(2);
    });

    it("test 4: Commission twice returns 409", async () => {
      const assetId = randomUUID();
      const commandId1 = randomUUID();
      const idempotencyKey1 = `idem-${randomUUID()}`;

      await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: commandId1,
            idempotencyKey: idempotencyKey1,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
            assetCode: "TRUCK-004",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
        token
      );

      const commandId2 = randomUUID();
      const idempotencyKey2 = `idem-${randomUUID()}`;
      await postCommand(
        {
          name: "commission-asset",
          version: 1,
          envelope: {
            commandId: commandId2,
            idempotencyKey: idempotencyKey2,
            expectedVersion: 1,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
          },
        },
        token
      );

      const commandId3 = randomUUID();
      const idempotencyKey3 = `idem-${randomUUID()}`;
      const res = await postCommand(
        {
          name: "commission-asset",
          version: 1,
          envelope: {
            commandId: commandId3,
            idempotencyKey: idempotencyKey3,
            expectedVersion: 2,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
          },
        },
        token
      );

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("INVALID_STATE_TRANSITION");
    });

    it("allows only one of two concurrent commands using the same row version", async () => {
      const assetId = randomUUID();
      const registerRes = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey: `idem-${randomUUID()}`,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
            assetCode: `RACE-${randomUUID().slice(0, 8)}`,
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
        token,
      );
      expect(registerRes.statusCode).toBe(200);

      const control = new pg.Client({ connectionString: inject("databaseUrl") });
      const concurrentApp = buildServer({
        db: ctx.runtimeDb,
        authDb: db,
        logger: false,
      });
      await concurrentApp.ready();
      await control.connect();
      await control.query(`
        create function test_delay_asset_update() returns trigger
        language plpgsql as $$
        begin
          perform pg_sleep(0.25);
          return new;
        end
        $$
      `);
      await control.query(`
        create trigger test_delay_asset_update
        before update on assets
        for each row execute function test_delay_asset_update()
      `);

      const commissionBody = () => ({
        name: "commission-asset",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          expectedVersion: 1,
          origin: "HUMAN_UI",
        },
        payload: { assetId },
      });

      try {
        const first = postCommand(commissionBody(), token);
        const second = concurrentApp.inject({
          method: "POST",
          url: "/v1/commands",
          payload: commissionBody(),
          headers: { authorization: `Bearer ${token}` },
        });

        const responses = await Promise.all([first, second]);
        expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
        const conflict = responses.find((response) => response.statusCode === 409);
        expect(conflict?.json()).toEqual({
          error: {
            code: "VERSION_CONFLICT",
            metadata: {
              expectedVersion: 1,
              currentVersion: 2,
            },
          },
        });
      } finally {
        await control.query("drop trigger if exists test_delay_asset_update on assets");
        await control.query("drop function if exists test_delay_asset_update()");
        await control.end();
        await concurrentApp.close();
      }
    });
  });

  describe("assign-asset", () => {
    it("test 5: Assign on disposed asset returns 409", async () => {
      const assetId = randomUUID();
      const commandId1 = randomUUID();
      const idempotencyKey1 = `idem-${randomUUID()}`;

      await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: commandId1,
            idempotencyKey: idempotencyKey1,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
            assetCode: "TRUCK-005",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
        token
      );

      // Manually set asset to SOLD
      await db.update(assets).set({ lifecycleStatus: "SOLD" }).where(eq(assets.id, assetId));

      const commandId2 = randomUUID();
      const idempotencyKey2 = `idem-${randomUUID()}`;
      const res = await postCommand(
        {
          name: "assign-asset",
          version: 1,
          envelope: {
            commandId: commandId2,
            idempotencyKey: idempotencyKey2,
            expectedVersion: 1,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
            branchCode: "DLA",
          },
        },
        token
      );

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("ASSET_NOT_OPERATIONAL");
    });

    it("test 6: Cross-branch assign returns 403 APPROVAL_REQUIRED", async () => {
      const assetId = randomUUID();
      const commandId1 = randomUUID();
      const idempotencyKey1 = `idem-${randomUUID()}`;

      await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: commandId1,
            idempotencyKey: idempotencyKey1,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
            assetCode: "TRUCK-006",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
        token
      );

      // Create second branch
      const [newBranch] = await db
        .insert(branches)
        .values({ workspaceId: workspace.id, code: "YAO", name: "Yaoundé" })
        .returning();

      const commandId2 = randomUUID();
      const idempotencyKey2 = `idem-${randomUUID()}`;
      const res = await postCommand(
        {
          name: "assign-asset",
          version: 1,
          envelope: {
            commandId: commandId2,
            idempotencyKey: idempotencyKey2,
            expectedVersion: 1,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
            branchCode: "YAO",
          },
        },
        token
      );

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("APPROVAL_REQUIRED");

      const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
      expect(asset).toBeDefined();
      expect(asset!.branchId).toBe(branch.id);
      expect(asset!.rowVersion).toBe(1);
    });
  });

  describe("register-asset validation", () => {
    it("test 7: register-asset with unknown assetClassCode returns 422", async () => {
      const assetId = randomUUID();
      const commandId = randomUUID();
      const idempotencyKey = `idem-${randomUUID()}`;

      const res = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId,
            idempotencyKey,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
            assetCode: "PLANE-001",
            assetClassCode: "PLANE",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
        token
      );

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("REFERENCE_NOT_FOUND");
      expect(body.error.metadata.referenceType).toBe("assetClass");
    });

    it("test 8: register-asset with invalid customValues", async () => {
      const assetId1 = randomUUID();
      const commandId1 = randomUUID();
      const idempotencyKey1 = `idem-${randomUUID()}`;

      // Wrong type for axleCount
      const res1 = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: commandId1,
            idempotencyKey: idempotencyKey1,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId: assetId1,
            assetCode: "TRUCK-007",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
            customValues: {
              axleCount: "three",
            },
          },
        },
        token
      );

      expect(res1.statusCode).toBe(400);
      const body1 = JSON.parse(res1.body);
      expect(body1.error.code).toBe("TEMPLATE_FIELD_INVALID");

      // Correct type - should succeed
      const assetId2 = randomUUID();
      const commandId2 = randomUUID();
      const idempotencyKey2 = `idem-${randomUUID()}`;
      const res2 = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: commandId2,
            idempotencyKey: idempotencyKey2,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId: assetId2,
            assetCode: "TRUCK-008",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
            customValues: {
              axleCount: 3,
            },
          },
        },
        token
      );

      expect(res2.statusCode).toBe(200);
      const [asset] = await db.select().from(assets).where(eq(assets.id, assetId2));
      expect(asset).toBeDefined();
      expect(asset!.templateVersion).toBe(1);
    });

    it("test 9: register-asset PASSENGER_TRANSPORT missing required field", async () => {
      const assetId = randomUUID();
      const commandId = randomUUID();
      const idempotencyKey = `idem-${randomUUID()}`;

      const res = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId,
            idempotencyKey,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
            assetCode: "BUS-001",
            assetClassCode: "BUS",
            templateCode: "PASSENGER_TRANSPORT",
            branchCode: "DLA",
            customValues: {
              lineType: "City",
            },
          },
        },
        token
      );

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("TEMPLATE_FIELD_INVALID");
    });
  });
});

/**
 * Custody through assign-asset (#44): `null` clears it, and only an active
 * member whose branches cover the vehicle's branch may hold it.
 */
describe("assign-asset custodian", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let admin: Actor;
  let financeApprover: Actor;
  let dlaDriver: Actor;
  let garDriver: Actor;
  let leaver: Actor;
  let outsider: Actor;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    const workspaceId = seeded.workspace.id;
    const [garoua] = await ctx.db
      .insert(branches)
      .values({ workspaceId, code: "GAR", name: "Garoua" })
      .returning();
    if (!garoua) throw new Error("branch insert returned no row");

    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    financeApprover = await seedActor(ctx.db, { workspaceId, role: "FINANCE_APPROVER" });
    dlaDriver = await seedActor(ctx.db, {
      workspaceId,
      role: "FIELD_SUBMITTER",
      branchIds: [seeded.branch.id],
    });
    garDriver = await seedActor(ctx.db, {
      workspaceId,
      role: "FIELD_SUBMITTER",
      branchIds: [garoua.id],
    });
    leaver = await seedActor(ctx.db, { workspaceId, role: "FIELD_SUBMITTER" });
    await api.ok(admin.token, "deactivate-member", { principalId: leaver.principalId });

    const other = await seedWorkspace(ctx.db);
    outsider = await seedActor(ctx.db, { workspaceId: other.workspace.id, role: "ADMIN" });
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function custodianOf(assetId: string) {
    const [row] = await ctx.db
      .select({ custodian: assets.custodianMembershipId, rowVersion: assets.rowVersion })
      .from(assets)
      .where(eq(assets.id, assetId));
    return row!;
  }

  it("sets, then clears, the custodian", async () => {
    const assetId = await seedAsset(ctx.app, admin.token);
    const set = await api.ok(
      admin.token,
      "assign-asset",
      { assetId, custodianMembershipId: dlaDriver.membershipId },
      { expectedVersion: 1 },
    );
    expect(await custodianOf(assetId)).toEqual({ custodian: dlaDriver.membershipId, rowVersion: 2 });

    const cleared = await api.ok(
      admin.token,
      "assign-asset",
      { assetId, custodianMembershipId: null },
      { expectedVersion: set.rowVersion },
    );
    expect(cleared.rowVersion).toBe(3);
    expect(await custodianOf(assetId)).toEqual({ custodian: null, rowVersion: 3 });

    const [event] = await ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.commandId, cleared.commandId), eq(auditEvents.eventType, "asset.assigned")));
    expect(event?.changedFields).toContain("custodianMembershipId");
    expect(event?.afterState).toMatchObject({ custodianMembershipId: null });
  });

  it("refuses a deactivated member", async () => {
    const assetId = await seedAsset(ctx.app, admin.token);
    const reply = await api.send(
      admin.token,
      "assign-asset",
      { assetId, custodianMembershipId: leaver.membershipId },
      { expectedVersion: 1 },
    );
    expect(reply.status).toBe(422);
    expect(reply.body.error).toEqual({
      code: "CUSTODIAN_INELIGIBLE",
      metadata: { reason: "DEACTIVATED", membershipId: leaver.membershipId },
    });
    expect(await custodianOf(assetId)).toEqual({ custodian: null, rowVersion: 1 });
  });

  it("refuses a member whose branches do not cover the vehicle's", async () => {
    const assetId = await seedAsset(ctx.app, admin.token);
    const reply = await api.send(
      admin.token,
      "assign-asset",
      { assetId, custodianMembershipId: garDriver.membershipId },
      { expectedVersion: 1 },
    );
    expect(reply.status).toBe(422);
    expect(reply.body.error).toMatchObject({
      code: "CUSTODIAN_INELIGIBLE",
      metadata: { reason: "OUT_OF_SCOPE" },
    });
  });

  it("checks the custodian against the branch the vehicle moves to", async () => {
    const assetId = await seedAsset(ctx.app, admin.token);
    // The cross-branch rule makes the finance approver the one who may move it.
    const refused = await api.send(
      financeApprover.token,
      "assign-asset",
      { assetId, branchCode: "GAR", custodianMembershipId: dlaDriver.membershipId },
      { expectedVersion: 1 },
    );
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatchObject({
      code: "CUSTODIAN_INELIGIBLE",
      metadata: { reason: "OUT_OF_SCOPE" },
    });

    const moved = await api.send(
      financeApprover.token,
      "assign-asset",
      { assetId, branchCode: "GAR", custodianMembershipId: garDriver.membershipId },
      { expectedVersion: 1 },
    );
    expect(moved.status).toBe(200);
    expect(await custodianOf(assetId)).toEqual({ custodian: garDriver.membershipId, rowVersion: 2 });
  });

  it("refuses a membership from another workspace as not found", async () => {
    const assetId = await seedAsset(ctx.app, admin.token);
    const reply = await api.send(
      admin.token,
      "assign-asset",
      { assetId, custodianMembershipId: outsider.membershipId },
      { expectedVersion: 1 },
    );
    expect(reply.status).toBe(422);
    expect(reply.body.error?.code).toBe("REFERENCE_NOT_FOUND");
  });

  it("refuses a stale version", async () => {
    const assetId = await seedAsset(ctx.app, admin.token);
    await api.ok(
      admin.token,
      "assign-asset",
      { assetId, custodianMembershipId: dlaDriver.membershipId },
      { expectedVersion: 1 },
    );
    const reply = await api.send(
      admin.token,
      "assign-asset",
      { assetId, custodianMembershipId: null },
      { expectedVersion: 1 },
    );
    expect(reply.status).toBe(409);
    expect(reply.body.error?.code).toBe("VERSION_CONFLICT");
  });

  it("still requires a target: an empty assignment is invalid", async () => {
    const assetId = await seedAsset(ctx.app, admin.token);
    const reply = await api.send(admin.token, "assign-asset", { assetId }, { expectedVersion: 1 });
    expect(reply.status).toBe(400);
    expect(reply.body.error?.code).toBe("VALIDATION_FAILED");
  });
});
