import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

describe("GET /v1/assets/:assetId/documents", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let token: string;
  let assetId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const { workspace } = await seedWorkspace(ctx.db);
    const admin = await seedMember(ctx.db, { workspaceId: workspace.id, role: "ADMIN", allBranches: true });
    token = (await createSession(ctx.db, { principalId: admin.principal.id, workspaceId: workspace.id })).token;
    assetId = randomUUID();
    await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/register-asset",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        envelope: { commandId: randomUUID(), idempotencyKey: `documents-read-${randomUUID()}`, origin: "HUMAN_UI" },
        payload: { assetId, assetCode: `DOC-${randomUUID().slice(0, 8)}`, assetClassCode: "TRUCK", templateCode: "TRUCKING", branchCode: "DLA" },
      },
    });
    await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/add-or-renew-document",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        envelope: { commandId: randomUUID(), idempotencyKey: `documents-read-${randomUUID()}`, origin: "HUMAN_UI" },
        payload: { documentId: randomUUID(), assetId, documentTypeCode: "INSURANCE", title: "Assurance", expiresAt: "2026-08-01" },
      },
    });
  });

  afterAll(async () => ctx.close());

  it("returns the asset document view", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/assets/${assetId}/documents`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      assetId,
      documents: [expect.objectContaining({ type: expect.objectContaining({ code: "INSURANCE" }), title: "Assurance" })],
    });
  });

  it("rejects malformed asset ids as validation errors", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/v1/assets/not-a-uuid/documents",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: "VALIDATION_FAILED" } });
  });
});
