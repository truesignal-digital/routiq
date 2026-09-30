import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { sourceArtifacts } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

describe("GET /v1/assets/:assetId/documents", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let token: string;
  let assetId: string;
  let workspaceId: string;
  let principalId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const { workspace } = await seedWorkspace(ctx.db);
    const admin = await seedMember(ctx.db, { workspaceId: workspace.id, role: "ADMIN", allBranches: true });
    workspaceId = workspace.id;
    principalId = admin.principal.id;
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

  it("counts the files attached to the command that recorded each document", async () => {
    const artifactId = randomUUID();
    await ctx.db.insert(sourceArtifacts).values({
      id: artifactId,
      workspaceId,
      storageKey: `ws/${workspaceId}/finalized-artifacts/${artifactId}/abc`,
      sha256: "abc",
      mimeType: "application/pdf",
      sizeBytes: 1024n,
      uploadedByPrincipalId: principalId,
    });
    const scannedId = randomUUID();
    const added = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/add-or-renew-document",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `documents-read-${randomUUID()}`,
          origin: "HUMAN_UI",
          sourceArtifactIds: [artifactId],
        },
        payload: { documentId: scannedId, assetId, documentTypeCode: "PERMIT", title: "Carte grise" },
      },
    });
    expect(added.statusCode).toBe(200);

    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/assets/${assetId}/documents`,
      headers: { authorization: `Bearer ${token}` },
    });
    const documents = (response.json() as { documents: Array<{ id: string; title: string; artifactCount: number }> })
      .documents;
    expect(documents.find((document) => document.id === scannedId)?.artifactCount).toBe(1);
    expect(documents.find((document) => document.title === "Assurance")?.artifactCount).toBe(0);
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
