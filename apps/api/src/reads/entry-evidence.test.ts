import { randomUUID } from "node:crypto";
import { ENTRY_EVIDENCE_STATES, financeSummaryResponse, financialEntryListResponse } from "@routiq/contracts";
import {
  ENTRY_EVIDENCE_STATES as DOMAIN_EVIDENCE_STATES,
  entryEvidenceState,
  type EntryPaymentMethod,
} from "@routiq/domain";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { financialEntries, sourceArtifacts } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";
import { entryArtifactCountSql, entryEvidenceMissingSql, entryEvidenceStateSql } from "./entry-evidence.js";

/**
 * The evidence rule lives twice: the TypeScript predicate every read and the
 * writer's warning use, and its SQL mirror behind `evidence=MISSING`. This
 * suite records one entry per row of the truth table and holds the two to the
 * same answer.
 */
describe("entry evidence: SQL and TypeScript agree", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let admin: Actor;
  let assetId: string;
  let workspaceId: string;

  interface Case {
    categoryCode: "FUEL" | "TOLLS";
    policy: "RECEIPT_EXPECTED" | "NO_RECEIPT_EXPECTED";
    paymentMethod: EntryPaymentMethod;
    paymentReference: string | null;
    withFile: boolean;
  }
  const recorded = new Map<string, Case>();

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    assetId = await seedAsset(ctx.app, admin.token);

    for (const [categoryCode, policy] of [
      ["FUEL", "RECEIPT_EXPECTED"],
      ["TOLLS", "NO_RECEIPT_EXPECTED"],
    ] as const) {
      for (const paymentMethod of ["CASH", "MOMO", "BANK", "OTHER"] as const) {
        for (const paymentReference of [null, "REF-42"]) {
          for (const withFile of [false, true]) {
            const sourceArtifactIds: string[] = [];
            if (withFile) {
              const id = randomUUID();
              await ctx.db.insert(sourceArtifacts).values({
                id,
                workspaceId,
                storageKey: `ws/${workspaceId}/finalized-artifacts/${id}/x`,
                sha256: "x",
                mimeType: "application/pdf",
                sizeBytes: 10n,
                uploadedByPrincipalId: admin.principalId,
              });
              sourceArtifactIds.push(id);
            }
            const entryId = randomUUID();
            await api.ok(
              admin.token,
              "record-expense",
              {
                entryId,
                branchCode: "DLA",
                categoryCode,
                economicDate: "2026-08-03",
                amountMinor: 10_000,
                paymentMethod,
                ...(paymentReference === null ? {} : { paymentReference }),
                postings: [{ assetId, amountMinor: 10_000 }],
              },
              { sourceArtifactIds },
            );
            recorded.set(entryId, { categoryCode, policy, paymentMethod, paymentReference, withFile });
          }
        }
      }
    }
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function list(query: string) {
    const response = await api.get(admin.token, `/v1/finance/entries?assetId=${assetId}&limit=100${query}`);
    expect(response.status).toBe(200);
    return financialEntryListResponse.parse(response.body).entries;
  }

  it("publishes the same four states on both sides of the wire", () => {
    expect([...ENTRY_EVIDENCE_STATES]).toEqual([...DOMAIN_EVIDENCE_STATES]);
  });

  it("gives every entry the state the predicate gives its facts", async () => {
    const entries = await list("");
    expect(entries).toHaveLength(recorded.size);
    for (const entry of entries) {
      const facts = recorded.get(entry.id)!;
      expect(entry.evidence.state, JSON.stringify(facts)).toBe(
        entryEvidenceState({
          policy: facts.policy,
          artifactCount: facts.withFile ? 1 : 0,
          paymentMethod: facts.paymentMethod,
          paymentReference: facts.paymentReference,
        }),
      );
    }
  });

  it("filters MISSING exactly where the predicate says NOT_SUPPLIED", async () => {
    const missing = new Set((await list("&evidence=MISSING")).map((entry) => entry.id));
    const expected = [...recorded.entries()]
      .filter(
        ([, facts]) =>
          entryEvidenceState({
            policy: facts.policy,
            artifactCount: facts.withFile ? 1 : 0,
            paymentMethod: facts.paymentMethod,
            paymentReference: facts.paymentReference,
          }) === "NOT_SUPPLIED",
      )
      .map(([id]) => id);
    // FUEL without a file: CASH and OTHER either way, MOMO and BANK without a reference.
    expect(expected).toHaveLength(6);
    expect(missing).toEqual(new Set(expected));
  });
});

/**
 * The fragments correlate on the outer `financial_entries` row. Drizzle writes
 * a bare column name when a select reads one table, and inside the subquery a
 * bare name binds to the subquery's own table (#483); the finance summary's
 * missing count is such a select. An entry whose cancellation has posted no
 * longer asks for its receipt (#473).
 */
describe("entry evidence fragments, whatever the outer select reads", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let director: Actor;
  let workspaceId: string;
  let assetId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    director = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    assetId = await seedAsset(ctx.app, director.token);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function file(): Promise<string> {
    const id = randomUUID();
    await ctx.db.insert(sourceArtifacts).values({
      id,
      workspaceId,
      storageKey: `ws/${workspaceId}/finalized-artifacts/${id}/x`,
      sha256: "x",
      mimeType: "image/jpeg",
      sizeBytes: 1n,
      uploadedByPrincipalId: director.principalId,
    });
    return id;
  }

  async function expense(sourceArtifactIds: string[] = []) {
    const entryId = randomUUID();
    const result = await api.ok(
      director.token,
      "record-expense",
      {
        entryId,
        branchCode: "DLA",
        categoryCode: "FUEL",
        economicDate: "2026-08-03",
        amountMinor: 10_000,
        paymentMethod: "CASH",
        postings: [{ assetId, amountMinor: 10_000 }],
      },
      { sourceArtifactIds },
    );
    return { entryId, rowVersion: result.rowVersion };
  }

  /** The three fragments in a select that reads `financial_entries` alone. */
  async function singleTable(entryId: string) {
    const [row] = await ctx.db
      .select({
        artifactCount: entryArtifactCountSql(),
        state: entryEvidenceStateSql(),
        missing: sql<boolean>`${entryEvidenceMissingSql()}`,
      })
      .from(financialEntries)
      .where(eq(financialEntries.id, entryId));
    return row;
  }

  it("names the outer entry's table in every correlation of a single-table select (#483)", () => {
    // Each fragment straight in the select list, where Drizzle drops the table name.
    const { sql: text } = ctx.db
      .select({
        artifactCount: entryArtifactCountSql(),
        state: entryEvidenceStateSql(),
        missing: entryEvidenceMissingSql(),
      })
      .from(financialEntries)
      .toSQL();
    for (const column of ["workspace_id", "id", "created_by_command_id", "category_id"]) {
      expect(text).toContain(`= "financial_entries"."${column}"`);
    }
    // A bare name here binds to the subquery's own table: `"workspace_id" = "workspace_id"`.
    expect(text).not.toMatch(/= "(workspace_id|id|created_by_command_id|category_id)"/);
  });

  it("counts a file attached after recording (#483)", async () => {
    const { entryId } = await expense();
    const attached = await file();
    await api.ok(
      director.token,
      "attach-evidence",
      { entryId, artifactIds: [attached] },
      { sourceArtifactIds: [attached] },
    );

    expect(await singleTable(entryId)).toEqual({ artifactCount: 1, state: "SUPPLIED", missing: false });
  });

  it("counts a file recorded with the entry, and none for an entry without", async () => {
    const recorded = await expense([await file()]);
    const bare = await expense();

    expect(await singleTable(recorded.entryId)).toEqual({ artifactCount: 1, state: "SUPPLIED", missing: false });
    expect(await singleTable(bare.entryId)).toEqual({ artifactCount: 0, state: "NOT_SUPPLIED", missing: true });
  });

  it("stops asking for the receipt of an entry whose cancellation has posted (#473)", async () => {
    const original = await expense();
    const reversalEntryId = randomUUID();
    await api.ok(
      director.token,
      "reverse-entry",
      { reversalEntryId, originalEntryId: original.entryId, reason: "Doublon" },
      { expectedVersion: original.rowVersion },
    );

    // Still no receipt on file, and the state says so; nobody is asked for one.
    expect(await singleTable(original.entryId)).toEqual({ artifactCount: 0, state: "NOT_SUPPLIED", missing: false });
    expect((await singleTable(reversalEntryId))?.missing).toBe(false);

    const response = await api.get(director.token, `/v1/finance/entries?assetId=${assetId}&limit=100&evidence=MISSING`);
    expect(response.status).toBe(200);
    const missing = financialEntryListResponse.parse(response.body).entries.map((entry) => entry.id);
    expect(missing).not.toContain(original.entryId);
    expect(missing).not.toContain(reversalEntryId);
  });

  it("gives the finance summary the entries list's missing-receipt count", async () => {
    const listed = await api.get(director.token, "/v1/finance/entries?limit=100&evidence=MISSING");
    expect(listed.status).toBe(200);
    const summary = await api.get(director.token, "/v1/finance/summary");
    expect(summary.status, JSON.stringify(summary.body)).toBe(200);
    expect(financeSummaryResponse.parse(summary.body).missingReceipt.count).toBe(
      financialEntryListResponse.parse(listed.body).entries.length,
    );
  });
});
