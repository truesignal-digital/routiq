import { randomUUID } from "node:crypto";
import {
  assetDocumentsReadResponse,
  issueDetail,
  type RecordArtifact,
} from "@routiq/contracts";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import type { Db } from "../db/client.js";
import * as schema from "../db/schema.js";
import { branches, sourceArtifacts } from "../db/schema.js";
import { buildServer } from "../server.js";
import type { ObjectStorage } from "../storage/types.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

/**
 * Review P1: a file linked to a record is that record's, so its URL is only
 * for a caller who may read the record — through the record's own route. The
 * generic route keeps only what it is for: the uploader's own file before any
 * command links it. Storage is never asked for a URL before that is settled.
 */
describe("record-scoped downloads", () => {
  let ownerPool: pg.Pool;
  let runtimePool: pg.Pool;
  let db: Db;
  let app: ReturnType<typeof buildServer>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let admin: Actor;
  let dlaOnly: Actor;
  let ydeOnly: Actor;
  let dlaTruck: string;

  const storage = {
    presignPut: vi.fn(async () => "https://storage.test/put"),
    presignGet: vi.fn(async (key: string) => `https://storage.test/get/${key}`),
    getObject: vi.fn(async () => null),
    putObject: vi.fn(async () => undefined),
  } satisfies ObjectStorage;

  async function upload(by: Actor, originalFileName: string | null = "scan.jpg"): Promise<string> {
    const id = randomUUID();
    const sha = id.replaceAll("-", "");
    await db.insert(sourceArtifacts).values({
      id,
      workspaceId,
      storageKey: `ws/${workspaceId}/finalized-artifacts/${id}/${sha}`,
      sha256: sha,
      mimeType: "image/jpeg",
      sizeBytes: 2_048n,
      originalFileName,
      uploadedByPrincipalId: by.principalId,
    });
    return id;
  }

  const fileEntry = (artifactId: string): RecordArtifact => ({
    artifactId,
    mimeType: "image/jpeg",
    sizeBytes: 2_048,
    originalFileName: "scan.jpg",
  });

  beforeAll(async () => {
    const ownerUrl = inject("databaseUrl");
    ownerPool = new pg.Pool({ connectionString: ownerUrl });
    db = drizzle(ownerPool, { schema }) as unknown as Db;
    const runtimeUrl = new URL(ownerUrl);
    runtimeUrl.username = "routiq_app";
    runtimeUrl.password = "routiq_app";
    runtimePool = new pg.Pool({ connectionString: runtimeUrl.toString() });
    app = buildServer({
      db: drizzle(runtimePool, { schema }) as unknown as Db,
      authDb: db,
      storage,
      logger: false,
    });
    await app.ready();
    api = apiClient(app);

    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;
    const [yaounde] = await db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();
    admin = await seedActor(db, { workspaceId, role: "ADMIN" });
    dlaOnly = await seedActor(db, {
      workspaceId,
      role: "DRIVER",
      branchIds: [seeded.branch.id],
    });
    ydeOnly = await seedActor(db, { workspaceId, role: "ADMIN", branchIds: [yaounde!.id] });
    dlaTruck = await seedAsset(app, admin.token, { branchCode: "DLA" });
  });

  beforeEach(() => {
    storage.presignGet.mockClear();
  });

  afterAll(async () => {
    await app?.close();
    await runtimePool?.end();
    await ownerPool?.end();
  });

  const generic = (artifactId: string) => `/v1/artifacts/${artifactId}/download-url`;

  describe("the generic route", () => {
    it("hands the uploader their own file until a command links it", async () => {
      const receipt = await upload(dlaOnly);
      const own = await api.get(dlaOnly.token, generic(receipt));
      expect(own.status).toBe(200);
      expect(own.body).toEqual({ url: expect.stringContaining(`finalized-artifacts/${receipt}/`) });

      // Nobody else, not even an admin: an unlinked upload belongs to no record yet.
      expect((await api.get(admin.token, generic(receipt))).status).toBe(404);

      await api.ok(
        dlaOnly.token,
        "record-expense",
        {
          entryId: randomUUID(),
          branchCode: "DLA",
          categoryCode: "FUEL",
          economicDate: "2026-08-12",
          amountMinor: 30_000,
          paymentMethod: "CASH",
          postings: [{ assetId: dlaTruck, amountMinor: 30_000 }],
        },
        { sourceArtifactIds: [receipt] },
      );
      const linked = await api.get(dlaOnly.token, generic(receipt));
      expect(linked.status).toBe(404);
      expect(linked.body).toEqual({ error: { code: "REFERENCE_NOT_FOUND" } });
      expect(storage.presignGet).toHaveBeenCalledTimes(1);
    });

    it("answers 400 for a malformed id", async () => {
      expect((await api.get(admin.token, generic("nope"))).status).toBe(400);
      expect(storage.presignGet).not.toHaveBeenCalled();
    });

    it("keeps a Douala receipt from a Yaoundé member on every route (P1)", async () => {
      const receipt = await upload(admin);
      const entryId = randomUUID();
      await api.ok(
        admin.token,
        "record-expense",
        {
          entryId,
          branchCode: "DLA",
          categoryCode: "FUEL",
          economicDate: "2026-08-12",
          amountMinor: 30_000,
          paymentMethod: "CASH",
          postings: [{ assetId: dlaTruck, amountMinor: 30_000 }],
        },
        { sourceArtifactIds: [receipt] },
      );
      for (const route of [
        generic(receipt),
        `/v1/finance/entries/${entryId}/evidence/${receipt}/download-url`,
      ]) {
        const response = await api.get(ydeOnly.token, route);
        expect(response.status, route).toBe(404);
        expect(response.body, route).toEqual({ error: { code: "REFERENCE_NOT_FOUND" } });
      }
      expect(storage.presignGet).not.toHaveBeenCalled();
    });
  });

  describe("a vehicle document's scan", () => {
    let documentId: string;
    let scan: string;

    beforeAll(async () => {
      scan = await upload(admin);
      documentId = randomUUID();
      await api.ok(
        admin.token,
        "add-or-renew-document",
        {
          documentId,
          assetId: dlaTruck,
          documentTypeCode: "INSURANCE",
          expiresAt: "2027-01-01",
        },
        { sourceArtifactIds: [scan] },
      );
    });

    const route = (assetId: string, docId: string, artifactId: string) =>
      `/v1/assets/${assetId}/documents/${docId}/artifacts/${artifactId}/download-url`;

    it("is listed on the documents read", async () => {
      const read = await api.get(admin.token, `/v1/assets/${dlaTruck}/documents`);
      const body = assetDocumentsReadResponse.parse(read.body);
      expect(body.documents.find((document) => document.id === documentId)).toMatchObject({
        artifactCount: 1,
        artifacts: [fileEntry(scan)],
      });
    });

    it("downloads through the document, for readers of the vehicle only", async () => {
      for (const actor of [admin, dlaOnly]) {
        const response = await api.get(actor.token, route(dlaTruck, documentId, scan));
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ url: expect.stringContaining(`finalized-artifacts/${scan}/`) });
      }
      expect(storage.presignGet).toHaveBeenCalledTimes(2);
      storage.presignGet.mockClear();

      const outside = await api.get(ydeOnly.token, route(dlaTruck, documentId, scan));
      expect(outside.status).toBe(404);
      expect((await api.get(admin.token, generic(scan))).status).toBe(404);
      expect(storage.presignGet).not.toHaveBeenCalled();
    });

    it("answers 404 when the document, vehicle and file do not belong together", async () => {
      const otherTruck = await seedAsset(app, admin.token, { branchCode: "DLA" });
      const stranger = await upload(admin);
      for (const url of [
        route(otherTruck, documentId, scan),
        route(dlaTruck, randomUUID(), scan),
        route(dlaTruck, documentId, stranger),
      ]) {
        expect((await api.get(admin.token, url)).status, url).toBe(404);
      }
      expect((await api.get(admin.token, route(dlaTruck, documentId, "nope"))).status).toBe(400);
      expect(storage.presignGet).not.toHaveBeenCalled();
    });

    it("answers MODULE_DISABLED when DOCUMENTS is off", async () => {
      const gated = await seedWorkspace(db);
      const gatedAdmin = await seedActor(db, { workspaceId: gated.workspace.id, role: "DIRECTOR" });
      await api.ok(gatedAdmin.token, "disable-module", { moduleCode: "DOCUMENTS" });
      const response = await api.get(
        gatedAdmin.token,
        route(randomUUID(), randomUUID(), randomUUID()),
      );
      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: { code: "MODULE_DISABLED", metadata: { module: "DOCUMENTS" } },
      });
      expect(storage.presignGet).not.toHaveBeenCalled();
    });
  });

  describe("a signalement's photo", () => {
    let issueId: string;
    let photo: string;

    beforeAll(async () => {
      photo = await upload(dlaOnly);
      issueId = randomUUID();
      await api.ok(
        dlaOnly.token,
        "report-issue",
        { issueId, assetId: dlaTruck, description: "Pneu à plat", safetyCritical: false },
        { sourceArtifactIds: [photo] },
      );
    });

    const route = (issue: string, artifactId: string) =>
      `/v1/issues/${issue}/artifacts/${artifactId}/download-url`;

    it("is listed on the issue detail", async () => {
      const read = await api.get(admin.token, `/v1/issues/${issueId}`);
      expect(issueDetail.parse(read.body)).toMatchObject({
        artifactCount: 1,
        artifacts: [fileEntry(photo)],
      });
    });

    it("downloads through the issue, for readers of its vehicle only", async () => {
      const response = await api.get(admin.token, route(issueId, photo));
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ url: expect.stringContaining(`finalized-artifacts/${photo}/`) });
      expect(storage.presignGet).toHaveBeenCalledTimes(1);
      storage.presignGet.mockClear();

      for (const [actor, url] of [
        [ydeOnly, route(issueId, photo)],
        [admin, route(randomUUID(), photo)],
        [admin, route(issueId, await upload(admin))],
        [dlaOnly, generic(photo)],
      ] as const) {
        expect((await api.get(actor.token, url)).status, url).toBe(404);
      }
      expect(storage.presignGet).not.toHaveBeenCalled();
    });

    it("answers MODULE_DISABLED when MAINTENANCE is off", async () => {
      const gated = await seedWorkspace(db);
      const gatedAdmin = await seedActor(db, { workspaceId: gated.workspace.id, role: "DIRECTOR" });
      await api.ok(gatedAdmin.token, "disable-module", { moduleCode: "MAINTENANCE" });
      const response = await api.get(gatedAdmin.token, route(randomUUID(), randomUUID()));
      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: { code: "MODULE_DISABLED", metadata: { module: "MAINTENANCE" } },
      });
      expect(storage.presignGet).not.toHaveBeenCalled();
    });
  });
});
