import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { assets, branches } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

describe("command branch authorization", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  let doualaBranchId: string;
  let adminToken: string;
  let scopedOpsToken: string;
  let scopedFieldToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    doualaBranchId = seeded.branch.id;
    await ctx.db.insert(branches).values({
      workspaceId,
      code: "YDE",
      name: "Yaoundé",
    });

    const scopedOps = await seedMember(ctx.db, {
      workspaceId,
      role: "ADMIN",
      branchIds: [doualaBranchId],
    });
    scopedOpsToken = (
      await createSession(ctx.db, {
        principalId: scopedOps.principal.id,
        workspaceId,
      })
    ).token;

    const admin = await seedMember(ctx.db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    adminToken = (
      await createSession(ctx.db, {
        principalId: admin.principal.id,
        workspaceId,
      })
    ).token;

    const scopedField = await seedMember(ctx.db, {
      workspaceId,
      role: "DRIVER",
      branchIds: [doualaBranchId],
    });
    scopedFieldToken = (
      await createSession(ctx.db, {
        principalId: scopedField.principal.id,
        workspaceId,
      })
    ).token;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("rejects registering an asset in a branch outside the actor's scope", async () => {
    const assetId = randomUUID();
    const response = await postCommand(scopedOpsToken, "register-asset", {
      assetId,
      assetCode: `OUT-OF-SCOPE-${randomUUID().slice(0, 8)}`,
      assetClassCode: "TRUCK",
      templateCode: "TRUCKING",
      branchCode: "YDE",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: "ROLE_FORBIDDEN",
        metadata: { command: "register-asset.v1" },
      },
    });
    expect(
      await ctx.db.select().from(assets).where(eq(assets.id, assetId)),
    ).toHaveLength(0);
  });

  it("rejects mutating an asset whose current branch is outside the actor's scope", async () => {
    const assetId = await registerAsset(adminToken, "YDE");

    const response = await postCommand(
      scopedOpsToken,
      "commission-asset",
      { assetId },
      1,
    );

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: "ROLE_FORBIDDEN",
        metadata: { command: "commission-asset.v1" },
      },
    });
    const [asset] = await ctx.db
      .select()
      .from(assets)
      .where(eq(assets.id, assetId));
    expect(asset?.lifecycleStatus).toBe("REGISTERED");
    expect(asset?.rowVersion).toBe(1);
  });

  it("rejects adding a document to an asset outside the actor's scope", async () => {
    const assetId = await registerAsset(adminToken, "YDE");
    const documentId = randomUUID();

    const response = await postCommand(
      scopedFieldToken,
      "add-or-renew-document",
      {
        documentId,
        assetId,
        documentTypeCode: "INSURANCE",
      },
    );

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: "ROLE_FORBIDDEN",
        metadata: { command: "add-or-renew-document.v1" },
      },
    });
  });

  it("rejects assigning an asset whose source branch is outside the actor's scope", async () => {
    const assetId = await registerAsset(adminToken, "YDE");

    const response = await postCommand(
      scopedOpsToken,
      "assign-asset",
      { assetId, branchCode: "YDE" },
      1,
    );

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: "ROLE_FORBIDDEN",
        metadata: { command: "assign-asset.v1" },
      },
    });
  });

  it("evaluates approval for a cross-branch move when the source asset is in scope", async () => {
    const assetId = await registerAsset(adminToken, "DLA");

    const response = await postCommand(
      scopedOpsToken,
      "assign-asset",
      { assetId, branchCode: "YDE" },
      1,
    );

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: "APPROVAL_REQUIRED",
        metadata: {
          commandType: "assign-asset",
        },
      },
    });
  });

  async function registerAsset(token: string, branchCode: string) {
    const assetId = randomUUID();
    const response = await postCommand(token, "register-asset", {
      assetId,
      assetCode: `BRANCH-${randomUUID().slice(0, 8)}`,
      assetClassCode: "TRUCK",
      templateCode: "TRUCKING",
      branchCode,
    });
    expect(response.statusCode).toBe(200);
    return assetId;
  }

  function postCommand(
    token: string,
    name: string,
    payload: Record<string, unknown>,
    expectedVersion?: number,
  ) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name,
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `branch-auth-${randomUUID()}`,
          origin: "HUMAN_UI",
          ...(expectedVersion === undefined ? {} : { expectedVersion }),
        },
        payload,
      },
    });
  }
});
