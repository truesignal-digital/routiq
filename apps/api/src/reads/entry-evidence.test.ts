import { randomUUID } from "node:crypto";
import { ENTRY_EVIDENCE_STATES, financialEntryListResponse } from "@routiq/contracts";
import {
  ENTRY_EVIDENCE_STATES as DOMAIN_EVIDENCE_STATES,
  entryEvidenceState,
  type EntryPaymentMethod,
} from "@routiq/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sourceArtifacts } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

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
