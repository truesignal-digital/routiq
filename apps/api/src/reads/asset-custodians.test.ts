import { custodianCandidatesResponse } from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { branches } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

describe("GET /v1/assets/:assetId/custodian-candidates", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let admin: Actor;
  let manager: Actor;
  let dlaDriver: Actor;
  let ydeDriver: Actor;
  let leaver: Actor;
  let ydeManager: Actor;
  let submitter: Actor;
  let cashier: Actor;
  let outsider: Actor;
  let dlaAssetId: string;

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

    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN", displayName: "Diane" });
    manager = await seedActor(ctx.db, { workspaceId, role: "ADMIN", displayName: "Boris" });
    dlaDriver = await seedActor(ctx.db, {
      workspaceId,
      role: "DRIVER",
      branchIds: [seeded.branch.id],
      displayName: "Awa",
    });
    ydeDriver = await seedActor(ctx.db, {
      workspaceId,
      role: "DRIVER",
      branchIds: [yaounde.id],
      displayName: "Patrice",
    });
    leaver = await seedActor(ctx.db, { workspaceId, role: "DRIVER", displayName: "Ancien" });
    ydeManager = await seedActor(ctx.db, {
      workspaceId,
      role: "ADMIN",
      branchIds: [yaounde.id],
      displayName: "Yves",
    });
    submitter = await seedActor(ctx.db, { workspaceId, role: "DRIVER", displayName: "Sali" });
    cashier = await seedActor(ctx.db, { workspaceId, role: "CASHIER", displayName: "Paul" });
    const other = await seedWorkspace(ctx.db);
    outsider = await seedActor(ctx.db, { workspaceId: other.workspace.id, role: "ADMIN" });

    dlaAssetId = await seedAsset(ctx.app, admin.token, { assetCode: "CUST-01" });
    await api.ok(admin.token, "deactivate-member", { principalId: leaver.principalId });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("lists active members whose branches cover the vehicle, by name", async () => {
    const response = await api.get(manager.token, `/v1/assets/${dlaAssetId}/custodian-candidates`);
    expect(response.status).toBe(200);
    const { items } = custodianCandidatesResponse.parse(response.body);

    expect(items.map((item) => item.displayName)).toEqual([
      "Awa",
      "Boris",
      "Diane",
      "Paul",
      "Sali",
    ]);
    expect(items.find((item) => item.displayName === "Awa")).toEqual({
      membershipId: dlaDriver.membershipId,
      displayName: "Awa",
      role: "DRIVER",
    });
    // Patrice and Yves see only Yaoundé; Ancien was deactivated.
    const ids = items.map((item) => item.membershipId);
    expect(ids).not.toContain(ydeDriver.membershipId);
    expect(ids).not.toContain(ydeManager.membershipId);
    expect(ids).not.toContain(leaver.membershipId);
  });

  it("refuses roles that cannot change a custodian", async () => {
    for (const actor of [submitter, cashier]) {
      const response = await api.get(actor.token, `/v1/assets/${dlaAssetId}/custodian-candidates`);
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: { code: "ROLE_FORBIDDEN" } });
    }
  });

  it("answers 404 outside the caller's branches or workspace", async () => {
    for (const actor of [ydeManager, outsider]) {
      const response = await api.get(actor.token, `/v1/assets/${dlaAssetId}/custodian-candidates`);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: { code: "REFERENCE_NOT_FOUND" } });
    }
  });

  it("answers MODULE_DISABLED when ASSETS is off", async () => {
    const gated = await seedWorkspace(ctx.db);
    const gatedAdmin = await seedActor(ctx.db, { workspaceId: gated.workspace.id, role: "DIRECTOR" });
    const gatedAsset = await seedAsset(ctx.app, gatedAdmin.token);
    await api.ok(gatedAdmin.token, "disable-module", { moduleCode: "ASSETS" });

    const response = await api.get(gatedAdmin.token, `/v1/assets/${gatedAsset}/custodian-candidates`);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: { code: "MODULE_DISABLED", metadata: { module: "ASSETS" } },
    });
  });
});
