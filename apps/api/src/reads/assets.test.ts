import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { branches, categories } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

describe("GET /v1/assets", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let branchToken: string;
  let workspaceAId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const workspaceA = await seedWorkspace(ctx.db);
    workspaceAId = workspaceA.workspace.id;

    const [yaounde] = await ctx.db
      .insert(branches)
      .values({
        workspaceId: workspaceA.workspace.id,
        code: "YDE",
        name: "Yaoundé",
      })
      .returning();
    if (!yaounde) throw new Error("branch insert returned no row");


    const adminA = await seedMember(ctx.db, {
      workspaceId: workspaceA.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    const adminASession = await createSession(ctx.db, {
      principalId: adminA.principal.id,
      workspaceId: workspaceA.workspace.id,
    });

    const branchMember = await seedMember(ctx.db, {
      workspaceId: workspaceA.workspace.id,
      role: "OPS_MANAGER",
      branchIds: [workspaceA.branch.id],
    });
    branchToken = (
      await createSession(ctx.db, {
        principalId: branchMember.principal.id,
        workspaceId: workspaceA.workspace.id,
      })
    ).token;

    await registerAsset(adminASession.token, "TRK-DLA", "DLA");
    await registerAsset(adminASession.token, "TRK-YDE", "YDE");

    const workspaceB = await seedWorkspace(ctx.db);
    const adminB = await seedMember(ctx.db, {
      workspaceId: workspaceB.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    const adminBSession = await createSession(ctx.db, {
      principalId: adminB.principal.id,
      workspaceId: workspaceB.workspace.id,
    });
    await registerAsset(adminBSession.token, "OTHER-TENANT", "DLA");
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function registerAsset(token: string, assetCode: string, branchCode: string) {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "register-asset",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `read-test-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: {
          assetId: randomUUID(),
          assetCode,
          assetClassCode: "TRUCK",
          templateCode: "TRUCKING",
          branchCode,
          manufacturer: "Mercedes",
          model: "Actros",
        },
      },
    });
    expect(response.statusCode).toBe(200);
  }

  it("requires authentication", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/v1/assets" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: "AUTH_REQUIRED" } });
  });

  it("returns the screen-shaped view scoped to workspace and branch visibility", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/v1/assets",
      headers: { authorization: `Bearer ${branchToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      workspaceId: workspaceAId,
      assets: [
        expect.objectContaining({
          assetCode: "TRK-DLA",
          manufacturer: "Mercedes",
          model: "Actros",
          lifecycleStatus: "REGISTERED",
          category: {
            code: "TRUCK",
            labelFr: "Camion",
            labelEn: "Truck",
          },
          branch: { code: "DLA", name: "Douala" },
        }),
      ],
    });
  });
});
