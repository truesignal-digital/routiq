import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

describe("named command routes", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let token: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const { workspace } = await seedWorkspace(ctx.db);
    const admin = await seedMember(ctx.db, {
      workspaceId: workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    token = (
      await createSession(ctx.db, {
        principalId: admin.principal.id,
        workspaceId: workspace.id,
      })
    ).token;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("derives the command name from the canonical URL", async () => {
    const assetId = randomUUID();
    const body = {
      version: 1,
      envelope: {
        commandId: randomUUID(),
        idempotencyKey: `named-route-${randomUUID()}`,
        origin: "HUMAN_UI",
      },
      payload: {
        assetId,
        assetCode: `NAMED-${randomUUID().slice(0, 8)}`,
        assetClassCode: "TRUCK",
        templateCode: "TRUCKING",
        branchCode: "DLA",
      },
    };
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/register-asset",
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        recordId: assetId,
        rowVersion: 1,
        idempotentReplay: false,
      }),
    );

    const compatibilityReplay = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "register-asset", ...body },
    });
    expect(compatibilityReplay.statusCode).toBe(200);
    expect(compatibilityReplay.json()).toEqual(
      expect.objectContaining({
        recordId: assetId,
        idempotentReplay: true,
      }),
    );
  });

  it("returns stable dispatcher errors through the named route", async () => {
    const body = {
      version: 1,
      envelope: {
        commandId: randomUUID(),
        idempotencyKey: `named-route-${randomUUID()}`,
        origin: "HUMAN_UI",
      },
      payload: {},
    };
    const namedResponse = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/register-asset",
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });
    const compatibilityResponse = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "register-asset", ...body },
    });

    expect(namedResponse.statusCode).toBe(400);
    expect(compatibilityResponse.statusCode).toBe(namedResponse.statusCode);
    expect(compatibilityResponse.json()).toEqual(namedResponse.json());
    expect(namedResponse.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "VALIDATION_FAILED" }),
      }),
    );
  });
});
