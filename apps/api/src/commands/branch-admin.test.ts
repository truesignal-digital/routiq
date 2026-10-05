import { randomUUID } from "node:crypto";
import type { CommandOrigin } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { assets, auditEvents, branches, commands, persons } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

/**
 * rename-branch.v1 / set-branch-status.v1, and the write guard deactivation
 * exists to impose.
 *
 * The guards worth reading together: a deactivated branch takes no NEW record
 * (BRANCH_INACTIVE), but an asset already standing in one can still be moved out
 * — that transfer is the reason an admin deactivates a branch at all — and the
 * guard yields entirely to two things it must never outrank: an idempotent
 * replay (§5.3) and a fact a device captured while the branch was still open
 * (§6). The `assign-asset` tests and the last three here are the load-bearing
 * ones.
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
      role: "ADMIN",
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
      const branchId = await createBranch("RN1", "Douala Akwa");

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
      expect(audit?.beforeState).toMatchObject({ name: "Douala Akwa", rowVersion: 1 });
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

    /**
     * The name is what the shell shows for the current lens, so it identifies a
     * branch as strictly as the code does (`branches_ws_name_uq`).
     */
    it("refuses a rename onto a name another branch already holds", async () => {
      const taken = await createBranch("RN4", "Édéa");
      const branchId = await createBranch("RN5", "Nkongsamba");

      const response = await post("rename-branch", { branchId, name: "Édéa" }, {
        expectedVersion: 1,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: { code: "DUPLICATE_BRANCH_NAME" } });

      const [row] = await ctx.db.select().from(branches).where(eq(branches.id, branchId));
      expect(row).toMatchObject({ name: "Nkongsamba", rowVersion: 1 });
      const [untouched] = await ctx.db.select().from(branches).where(eq(branches.id, taken));
      expect(untouched?.name).toBe("Édéa");
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

    it("is DIRECTOR-only", async () => {
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

      // An ADMIN, not the DIRECTOR who set things up: Direction holds a
      // CROSS_BRANCH rule of its own and would move the truck outright.
      const asAdmin = await postCommand(
        opsToken,
        "assign-asset",
        { assetId, branchCode: "DLA" },
        { expectedVersion: 1 },
      );

      /*
       * The move reaches approval evaluation rather than being refused by the
       * branch resolver: a cross-branch transfer is the CROSS_BRANCH rule's
       * business (FINANCE by default), not the inactive-branch guard's.
       * BRANCH_INACTIVE here would mean assets were stranded by deactivation.
       */
      expect(asAdmin.statusCode).toBe(403);
      expect(asAdmin.json()).toMatchObject({
        error: { code: "APPROVAL_REQUIRED", metadata: { commandType: "assign-asset" } },
      });

      /*
       * And the approver the rule names can complete it. Until FINANCE
       * was added to assign-asset's allowedRoles they were rejected
       * ROLE_FORBIDDEN before approval ran, which left the transfer a dead end
       * for every role — an asset in a deactivated branch could never leave it.
       */
      const asApprover = await postCommand(
        await financeApproverToken(workspaceId),
        "assign-asset",
        { assetId, branchCode: "DLA" },
        { expectedVersion: 1 },
      );

      expect(asApprover.statusCode).toBe(200);
      const [moved] = await ctx.db.select().from(assets).where(eq(assets.id, assetId));
      expect(moved?.branchId).not.toBe(branchId);
    });

    it("does not let the finance approver make an ordinary same-branch assignment", async () => {
      const assetId = await seedAsset(ctx.app, token, { branchCode: "DLA" });

      const response = await postCommand(
        await financeApproverToken(workspaceId),
        "assign-asset",
        { assetId, branchCode: "DLA" },
        { expectedVersion: 1 },
      );

      // No CROSS_BRANCH context, so only the DIRECTOR and ADMIN rules match.
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: { code: "APPROVAL_REQUIRED", metadata: { commandType: "assign-asset" } },
      });
    });

    it("refuses moving an asset INTO a deactivated branch before approval is evaluated", async () => {
      const seeded = await seedWorkspace(ctx.db);
      const moveToken = await adminToken(seeded.workspace.id);
      const targetId = await createBranch("INTO1", "Sangmélima", moveToken);
      const assetId = await seedAsset(ctx.app, moveToken, { branchCode: "DLA" });
      expect(
        (
          await post(
            "set-branch-status",
            { branchId: targetId, active: false },
            { token: moveToken },
          )
        ).statusCode,
      ).toBe(200);

      const commandId = randomUUID();
      const response = await postCommand(
        moveToken,
        "assign-asset",
        { assetId, branchCode: "INTO1" },
        { expectedVersion: 1, commandId },
      );

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: { code: "BRANCH_INACTIVE", metadata: { branchCode: "INTO1" } },
      });

      /*
       * The point of the test: under the catalog defaults a cross-branch move
       * matches the CROSS_BRANCH rule, so evaluating approval first would answer
       * APPROVAL_REQUIRED and put a doomed transfer in front of an approver. The
       * only receipt this call leaves is its rejection, carrying no approval
       * outcome and no rule id.
       */
      const receipts = await ctx.db
        .select()
        .from(commands)
        .where(eq(commands.clientCommandId, commandId));
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({
        status: "REJECTED",
        failureCode: "BRANCH_INACTIVE",
        approvalOutcome: null,
        approvalRuleId: null,
      });
      expect(await ctx.db.select().from(commands).where(eq(commands.id, commandId))).toHaveLength(
        0,
      );

      const [asset] = await ctx.db.select().from(assets).where(eq(assets.id, assetId));
      expect(asset?.branchId).toBe(seeded.branch.id);
      expect(asset?.rowVersion).toBe(1);
    });

    it("still refuses a move INTO a deactivated branch replayed from an outbox", async () => {
      // The offline latitude below is for facts. A transfer is a decision about
      // where the fleet stands now, and no origin buys it a way in.
      const seeded = await seedWorkspace(ctx.db);
      const moveToken = await adminToken(seeded.workspace.id);
      const targetId = await createBranch("INTO2", "Mbalmayo", moveToken);
      const assetId = await seedAsset(ctx.app, moveToken, { branchCode: "DLA" });
      expect(
        (
          await post(
            "set-branch-status",
            { branchId: targetId, active: false },
            { token: moveToken },
          )
        ).statusCode,
      ).toBe(200);

      const response = await postCommand(
        moveToken,
        "assign-asset",
        { assetId, branchCode: "INTO2" },
        { expectedVersion: 1, origin: "OFFLINE_SYNC" },
      );

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: { code: "BRANCH_INACTIVE", metadata: { branchCode: "INTO2" } },
      });
    });

    it("accepts a fact replayed from an outbox into a branch deactivated since capture", async () => {
      const branchId = await createBranch("OFF1", "Kumba");
      expect((await post("set-branch-status", { branchId, active: false })).statusCode).toBe(200);

      const personId = randomUUID();
      const commandId = randomUUID();
      const response = await postCommand(
        token,
        "register-person",
        { personId, displayName: "Chauffeur", branchCode: "OFF1" },
        { commandId, origin: "OFFLINE_SYNC" },
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        recordId: personId,
        warnings: ["BRANCH_INACTIVE_AT_COMMIT"],
      });

      const [person] = await ctx.db.select().from(persons).where(eq(persons.id, personId));
      expect(person?.branchId).toBe(branchId);

      /*
       * The discrepancy has to outlive the response, or reconciliation has
       * nothing to work from. The receipt is where it lives: every row reaches
       * its own through `created_by_command_id`, so no column of its own.
       */
      const [receipt] = await ctx.db.select().from(commands).where(eq(commands.id, commandId));
      expect(receipt?.result).toMatchObject({ warnings: ["BRANCH_INACTIVE_AT_COMMIT"] });
    });

    it("replays the original result for an exact retry sent after deactivation", async () => {
      /*
       * §5.3: an exact retry answers with what the first call committed. The
       * write guard used to run before the receipt lookup, so deactivating the
       * branch in between turned a plain retry — which the web submission cache
       * sends on any network wobble — into a 422 for a record that already
       * exists, with nothing in the response naming it.
       */
      const branchId = await createBranch("RPL1", "Foumban");
      const personId = randomUUID();
      const envelope = {
        commandId: randomUUID(),
        idempotencyKey: `branch-admin-replay-${randomUUID()}`,
      };
      const payload = { personId, displayName: "Chauffeur", branchCode: "RPL1" };

      const first = await postCommand(token, "register-person", payload, envelope);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ recordId: personId, idempotentReplay: false });

      expect((await post("set-branch-status", { branchId, active: false })).statusCode).toBe(200);

      const retry = await postCommand(token, "register-person", payload, envelope);

      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toMatchObject({ recordId: personId, idempotentReplay: true });
      expect(await ctx.db.select().from(persons).where(eq(persons.id, personId))).toHaveLength(1);
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
      role: "DIRECTOR",
      allBranches: true,
    });
    return (
      await createSession(ctx.db, { workspaceId: workspace, principalId: admin.principal.id })
    ).token;
  }

  async function financeApproverToken(workspace: string): Promise<string> {
    const approver = await seedMember(ctx.db, {
      workspaceId: workspace,
      role: "FINANCE",
      allBranches: true,
    });
    return (
      await createSession(ctx.db, { workspaceId: workspace, principalId: approver.principal.id })
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
    const { token: asToken, ...envelope } = opts;
    return postCommand(asToken ?? token, name, payload, envelope);
  }

  interface EnvelopeOverrides {
    expectedVersion?: number;
    commandId?: string;
    idempotencyKey?: string;
    origin?: CommandOrigin;
  }

  function postCommand(
    asToken: string,
    name: string,
    payload: Record<string, unknown>,
    envelope: EnvelopeOverrides = {},
  ) {
    return ctx.app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${asToken}` },
      payload: {
        name,
        version: 1,
        envelope: {
          commandId: envelope.commandId ?? randomUUID(),
          idempotencyKey: envelope.idempotencyKey ?? `branch-admin-${randomUUID()}`,
          origin: envelope.origin ?? "HUMAN_UI",
          ...(envelope.expectedVersion === undefined
            ? {}
            : { expectedVersion: envelope.expectedVersion }),
        },
        payload,
      },
    });
  }
});
