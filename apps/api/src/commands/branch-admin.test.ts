import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { approvalRules, assets, auditEvents, branches } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

/**
 * rename-branch.v1 / set-branch-status.v1, and the write guard deactivation
 * exists to impose.
 *
 * The pair of guards worth reading together: a deactivated branch takes no NEW
 * record (BRANCH_INACTIVE), but an asset already standing in one can still be
 * moved out — that transfer is the reason an admin deactivates a branch at all,
 * so the two tests around `assign-asset` are the load-bearing ones here.
 */
describe("branch administration", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  let token: string;
  let opsToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    token = await adminToken(workspaceId);

    const ops = await seedMember(ctx.db, {
      workspaceId,
      role: "OPS_MANAGER",
      allBranches: true,
    });
    opsToken = (
      await createSession(ctx.db, { workspaceId, principalId: ops.principal.id })
    ).token;
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe("rename-branch", () => {
    it("renames a branch, bumps its version and audits both states", async () => {
      const branchId = await createBranch("RN1", "Douala");

      const response = await post("rename-branch", { branchId, name: "Douala — Bonabéri" }, {
        expectedVersion: 1,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ recordId: branchId, rowVersion: 2 });

      const [row] = await ctx.db.select().from(branches).where(eq(branches.id, branchId));
      expect(row).toMatchObject({
        code: "RN1",
        name: "Douala — Bonabéri",
        active: true,
        rowVersion: 2,
      });

      const [audit] = await ctx.db
        .select()
        .from(auditEvents)
        .where(
          and(eq(auditEvents.entityId, branchId), eq(auditEvents.eventType, "branch.renamed")),
        );
      expect(audit).toMatchObject({
        eventType: "branch.renamed",
        entityType: "branch",
        changedFields: ["name", "rowVersion"],
      });
      expect(audit?.beforeState).toMatchObject({ name: "Douala", rowVersion: 1 });
      expect(audit?.afterState).toMatchObject({ name: "Douala — Bonabéri", rowVersion: 2 });
    });

    it("rejects a rename at a stale expected version", async () => {
      const branchId = await createBranch("RN2", "Kribi");
      expect(
        (await post("rename-branch", { branchId, name: "Kribi Centre" }, { expectedVersion: 1 }))
          .statusCode,
      ).toBe(200);

      const stale = await post("rename-branch", { branchId, name: "Kribi Port" }, {
        expectedVersion: 1,
      });

      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({
        error: { code: "VERSION_CONFLICT", metadata: { expectedVersion: 1, currentVersion: 2 } },
      });

      const [row] = await ctx.db.select().from(branches).where(eq(branches.id, branchId));
      expect(row?.name).toBe("Kribi Centre");
    });

    it("requires an expected version", async () => {
      const branchId = await createBranch("RN3", "Buéa");

      const response = await post("rename-branch", { branchId, name: "Buéa Ville" });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: "EXPECTED_VERSION_REQUIRED" },
      });
    });
  });

  describe("set-branch-status", () => {
    it("deactivates one branch of several", async () => {
      const branchId = await createBranch("ST1", "Limbé");

      const response = await post("set-branch-status", { branchId, active: false });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        recordId: branchId,
        rowVersion: 2,
        recordStatus: "INACTIVE",
      });

      const [row] = await ctx.db.select().from(branches).where(eq(branches.id, branchId));
      expect(row?.active).toBe(false);

      const [audit] = await ctx.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.entityId, branchId),
            eq(auditEvents.eventType, "branch.deactivated"),
          ),
        );
      expect(audit).toMatchObject({ entityType: "branch", changedFields: ["active", "rowVersion"] });
    });

    it("refuses to deactivate the workspace's last active branch", async () => {
      // Its own workspace: the invariant counts every branch the workspace has,
      // so it can only be reached where exactly one is active.
      const soloWorkspace = await seedWorkspace(ctx.db);
      const soloToken = await adminToken(soloWorkspace.workspace.id);

      const response = await post(
        "set-branch-status",
        { branchId: soloWorkspace.branch.id, active: false },
        { token: soloToken },
      );

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: "LAST_BRANCH", metadata: { branchId: soloWorkspace.branch.id } },
      });

      const [row] = await ctx.db
        .select()
        .from(branches)
        .where(eq(branches.id, soloWorkspace.branch.id));
      expect(row?.active).toBe(true);
      expect(row?.rowVersion).toBe(1);
    });

    it("refuses a status change that would change nothing", async () => {
      const branchId = await createBranch("ST2", "Bafoussam");
      expect((await post("set-branch-status", { branchId, active: false })).statusCode).toBe(200);

      const response = await post("set-branch-status", { branchId, active: false });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: "BRANCH_STATUS_ALREADY_SET", metadata: { branchId, active: false } },
      });
    });

    it("honors an expected version when the caller sends one", async () => {
      const branchId = await createBranch("ST4", "Dschang");
      expect(
        (await post("rename-branch", { branchId, name: "Dschang Ville" }, { expectedVersion: 1 }))
          .statusCode,
      ).toBe(200);

      const stale = await post("set-branch-status", { branchId, active: false }, {
        expectedVersion: 1,
      });

      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({
        error: { code: "VERSION_CONFLICT", metadata: { expectedVersion: 1, currentVersion: 2 } },
      });

      const [row] = await ctx.db.select().from(branches).where(eq(branches.id, branchId));
      expect(row?.active).toBe(true);
    });

    it("is ADMIN-only", async () => {
      const branchId = await createBranch("ST3", "Ebolowa");

      const response = await post(
        "set-branch-status",
        { branchId, active: false },
        { token: opsToken },
      );

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });
    });
  });

  describe("inactive-branch write guard", () => {
    it("refuses a new asset filed under a deactivated branch", async () => {
      const branchId = await createBranch("IN1", "Garoua");
      expect((await post("set-branch-status", { branchId, active: false })).statusCode).toBe(200);

      const assetId = randomUUID();
      const response = await postCommand(token, "register-asset", {
        assetId,
        assetCode: `INACTIVE-${randomUUID().slice(0, 8)}`,
        assetClassCode: "TRUCK",
        templateCode: "TRUCKING",
        branchCode: "IN1",
      });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: { code: "BRANCH_INACTIVE", metadata: { branchCode: "IN1" } },
      });
      expect(await ctx.db.select().from(assets).where(eq(assets.id, assetId))).toHaveLength(0);
    });

    it("refuses a new person filed under a deactivated branch", async () => {
      const branchId = await createBranch("IN2", "Maroua");
      expect((await post("set-branch-status", { branchId, active: false })).statusCode).toBe(200);

      const response = await postCommand(token, "register-person", {
        personId: randomUUID(),
        displayName: "Chauffeur",
        branchCode: "IN2",
      });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: { code: "BRANCH_INACTIVE", metadata: { branchCode: "IN2" } },
      });
    });

    it("still lets an asset be moved OUT of a deactivated branch", async () => {
      const branchId = await createBranch("OUT1", "Ngaoundéré");
      const assetId = await seedAsset(ctx.app, token, { branchCode: "OUT1" });
      expect((await post("set-branch-status", { branchId, active: false })).statusCode).toBe(200);

      const response = await postCommand(
        token,
        "assign-asset",
        { assetId, branchCode: "DLA" },
        1,
      );

      /*
       * The move reaches approval evaluation rather than being refused by the
       * branch resolver: a cross-branch transfer is the CROSS_BRANCH rule's
       * business (FINANCE_APPROVER by default), not the inactive-branch guard's.
       * BRANCH_INACTIVE here would mean assets were stranded by deactivation.
       */
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: { code: "APPROVAL_REQUIRED", metadata: { commandType: "assign-asset" } },
      });
    });

    it("refuses moving an asset INTO a deactivated branch", async () => {
      // Its own workspace, with a CROSS_BRANCH rule this admin satisfies, so the
      // handler is reached at all — the default rule requires FINANCE_APPROVER,
      // which assign-asset does not admit.
      const seeded = await seedWorkspace(ctx.db);
      const crossToken = await adminToken(seeded.workspace.id);
      await ctx.db.insert(approvalRules).values({
        workspaceId: seeded.workspace.id,
        commandType: "assign-asset",
        categoryCode: "CROSS_BRANCH",
        branchId: null,
        amountMinMinor: null,
        amountMaxMinor: null,
        requiredRole: "ADMIN",
        createdByCommandId: null,
      });

      const targetId = await createBranch("INTO1", "Sangmélima", crossToken);
      const assetId = await seedAsset(ctx.app, crossToken, { branchCode: "DLA" });
      expect(
        (
          await post(
            "set-branch-status",
            { branchId: targetId, active: false },
            { token: crossToken },
          )
        ).statusCode,
      ).toBe(200);

      const response = await postCommand(
        crossToken,
        "assign-asset",
        { assetId, branchCode: "INTO1" },
        1,
      );

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: { code: "BRANCH_INACTIVE", metadata: { branchCode: "INTO1" } },
      });

      const [asset] = await ctx.db.select().from(assets).where(eq(assets.id, assetId));
      expect(asset?.branchId).toBe(seeded.branch.id);
      expect(asset?.rowVersion).toBe(1);
    });

    it("accepts writes again once the branch is reactivated", async () => {
      const branchId = await createBranch("RE1", "Bertoua");
      expect((await post("set-branch-status", { branchId, active: false })).statusCode).toBe(200);

      const blocked = await postCommand(token, "register-person", {
        personId: randomUUID(),
        displayName: "Chauffeur",
        branchCode: "RE1",
      });
      expect(blocked.json()).toMatchObject({ error: { code: "BRANCH_INACTIVE" } });

      const reactivated = await post("set-branch-status", { branchId, active: true });
      expect(reactivated.statusCode).toBe(200);
      expect(reactivated.json()).toMatchObject({ rowVersion: 3, recordStatus: "ACTIVE" });

      const personId = randomUUID();
      const accepted = await postCommand(token, "register-person", {
        personId,
        displayName: "Chauffeur",
        branchCode: "RE1",
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toMatchObject({ recordId: personId });

      const [audit] = await ctx.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.entityId, branchId),
            eq(auditEvents.eventType, "branch.reactivated"),
          ),
        );
      expect(audit).toMatchObject({ entityType: "branch" });
    });
  });

  async function adminToken(workspace: string): Promise<string> {
    const admin = await seedMember(ctx.db, {
      workspaceId: workspace,
      role: "ADMIN",
      allBranches: true,
    });
    return (
      await createSession(ctx.db, { workspaceId: workspace, principalId: admin.principal.id })
    ).token;
  }

  async function createBranch(code: string, name: string, asToken?: string): Promise<string> {
    const branchId = randomUUID();
    const response = await post(
      "create-branch",
      { branchId, code, name },
      { token: asToken ?? token },
    );
    expect(response.statusCode).toBe(200);
    return branchId;
  }

  function post(
    name: string,
    payload: Record<string, unknown>,
    opts: { token?: string; expectedVersion?: number } = {},
  ) {
    return postCommand(opts.token ?? token, name, payload, opts.expectedVersion);
  }

  function postCommand(
    asToken: string,
    name: string,
    payload: Record<string, unknown>,
    expectedVersion?: number,
  ) {
    return ctx.app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${asToken}` },
      payload: {
        name,
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `branch-admin-${randomUUID()}`,
          origin: "HUMAN_UI",
          ...(expectedVersion === undefined ? {} : { expectedVersion }),
        },
        payload,
      },
    });
  }
});
