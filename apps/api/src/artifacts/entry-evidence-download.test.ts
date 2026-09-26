import { randomUUID } from "node:crypto";
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
 * The entry-scoped download (PLAN §1.7): a receipt is a financial record's
 * paperwork, so its URL is only for someone who may read the entry — and the
 * storage layer is never asked for a URL before that is settled.
 */
describe("GET /v1/finance/entries/:entryId/evidence/:artifactId/download-url", () => {
  let ownerPool: pg.Pool;
  let runtimePool: pg.Pool;
  let db: Db;
  let app: ReturnType<typeof buildServer>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let admin: Actor;
  let dlaOnly: Actor;
  let ydeOnly: Actor;
  let assetId: string;
  let entryId: string;
  let recordedFile: string;
  let attachedFile: string;
  let strangerFile: string;

  const storage = {
    presignPut: vi.fn(async () => "https://storage.test/put"),
    presignGet: vi.fn(async (key: string) => `https://storage.test/get/${key}`),
    getObject: vi.fn(async () => null),
    putObject: vi.fn(async () => undefined),
  } satisfies ObjectStorage;

  async function artifact(): Promise<string> {
    const id = randomUUID();
    const sha = id.replaceAll("-", "");
    await db.insert(sourceArtifacts).values({
      id,
      workspaceId,
      storageKey: `ws/${workspaceId}/finalized-artifacts/${id}/${sha}`,
      sha256: sha,
      mimeType: "image/jpeg",
      sizeBytes: 100n,
      uploadedByPrincipalId: admin.principalId,
    });
    return id;
  }

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
      role: "FIELD_SUBMITTER",
      branchIds: [seeded.branch.id],
    });
    ydeOnly = await seedActor(db, { workspaceId, role: "OPS_MANAGER", branchIds: [yaounde!.id] });
    assetId = await seedAsset(app, admin.token);

    recordedFile = await artifact();
    entryId = randomUUID();
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
        postings: [{ assetId, amountMinor: 30_000 }],
      },
      { sourceArtifactIds: [recordedFile] },
    );
    attachedFile = await artifact();
    await api.ok(
      admin.token,
      "attach-evidence",
      { entryId, artifactIds: [attachedFile] },
      { sourceArtifactIds: [attachedFile] },
    );
    strangerFile = await artifact();
  });

  beforeEach(() => {
    storage.presignGet.mockClear();
  });

  afterAll(async () => {
    await app?.close();
    await runtimePool?.end();
    await ownerPool?.end();
  });

  const url = (entry: string, file: string) =>
    `/v1/finance/entries/${entry}/evidence/${file}/download-url`;

  it("hands a reader of the entry a URL for each of its files", async () => {
    for (const file of [recordedFile, attachedFile]) {
      for (const actor of [admin, dlaOnly]) {
        const response = await api.get(actor.token, url(entryId, file));
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          url: expect.stringContaining(`finalized-artifacts/${file}/`),
        });
      }
    }
    expect(storage.presignGet).toHaveBeenCalledTimes(4);
  });

  it("answers 404 outside the entry's branch, before storage is asked", async () => {
    const response = await api.get(ydeOnly.token, url(entryId, recordedFile));
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "REFERENCE_NOT_FOUND" } });
    expect(storage.presignGet).not.toHaveBeenCalled();
  });

  it("answers 404 for a file that is not the entry's", async () => {
    const response = await api.get(admin.token, url(entryId, strangerFile));
    expect(response.status).toBe(404);
    expect(storage.presignGet).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown entry and 400 for malformed ids", async () => {
    expect((await api.get(admin.token, url(randomUUID(), recordedFile))).status).toBe(404);
    expect((await api.get(admin.token, url("nope", recordedFile))).status).toBe(400);
    expect(storage.presignGet).not.toHaveBeenCalled();
  });

  it("answers MODULE_DISABLED when FINANCE is off", async () => {
    const gated = await seedWorkspace(db);
    const gatedAdmin = await seedActor(db, { workspaceId: gated.workspace.id, role: "ADMIN" });
    await api.ok(gatedAdmin.token, "disable-module", { moduleCode: "FINANCE" });
    const response = await api.get(gatedAdmin.token, url(randomUUID(), randomUUID()));
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: { code: "MODULE_DISABLED", metadata: { module: "FINANCE" } },
    });
    expect(storage.presignGet).not.toHaveBeenCalled();
  });
});
