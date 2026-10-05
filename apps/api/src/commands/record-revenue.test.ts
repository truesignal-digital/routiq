import { recordRevenueCommand } from "@routiq/contracts";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { financialEntries, financialPostings } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

describe("record-revenue.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let token: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;

    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;
    const submitter = await seedMember(db, {
      workspaceId,
      role: "CASHIER",
      allBranches: true,
    });
    token = (
      await createSession(db, {
        principalId: submitter.principal.id,
        workspaceId,
      })
    ).token;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("below-threshold revenue auto-posts", async () => {
    const entryId = randomUUID();
    const response = await postCommand({
      entryId,
      branchCode: "DLA",
      categoryCode: "FREIGHT_REVENUE",
      economicDate: "2026-07-24",
      amountMinor: 50_000,
      paymentMethod: "MOMO",
      paymentReference: "MOMO-123",
      postings: [{ amountMinor: 50_000 }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recordId: entryId,
      recordStatus: "POSTED",
      warnings: [],
    });

    const [entry] = await db
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.id, entryId));
    expect(entry).toMatchObject({
      workspaceId,
      direction: "REVENUE",
      status: "POSTED",
    });
    expect(entry?.postingPeriodId).not.toBeNull();
    expect(entry?.entryNumber).toMatch(/^DLA-\d{4}-\d{5}$/);

    const [posting] = await db
      .select()
      .from(financialPostings)
      .where(eq(financialPostings.financialEntryId, entryId));
    expect(posting).toMatchObject({
      workspaceId,
      direction: "REVENUE",
      postingPeriodId: entry?.postingPeriodId,
    });
  });

  it("above-threshold revenue submitted by CASHIER", async () => {
    const entryId = randomUUID();
    const response = await postCommand({
      entryId,
      branchCode: "DLA",
      categoryCode: "FREIGHT_REVENUE",
      economicDate: "2026-07-24",
      amountMinor: 100_001,
      paymentMethod: "MOMO",
      paymentReference: "MOMO-123",
      postings: [{ amountMinor: 100_001 }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recordId: entryId,
      recordStatus: "SUBMITTED",
    });

    const [entry] = await db
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.id, entryId));
    expect(entry).toMatchObject({
      status: "SUBMITTED",
      postingPeriodId: null,
    });
  });

  it("expense category on record-revenue rejected", async () => {
    const response = await postCommand({
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-07-24",
      amountMinor: 50_000,
      paymentMethod: "MOMO",
      paymentReference: "MOMO-123",
      postings: [{ amountMinor: 50_000 }],
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: "CATEGORY_KIND_MISMATCH",
        metadata: { expectedKind: "REVENUE_CATEGORY" },
      },
    });
  });

  it("cash revenue without evidence warning", async () => {
    const response = await postCommand({
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "FREIGHT_REVENUE",
      economicDate: "2026-07-24",
      amountMinor: 50_000,
      paymentMethod: "CASH",
      postings: [{ amountMinor: 50_000 }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().warnings).toContain("EVIDENCE_MISSING");
  });

  async function postCommand(payload: Record<string, unknown>) {
    const command = recordRevenueCommand.parse({
      name: "record-revenue",
      version: 1,
      envelope: {
        commandId: randomUUID(),
        idempotencyKey: `idem-${randomUUID()}`,
        origin: "HUMAN_UI",
      },
      payload,
    });
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: { authorization: `Bearer ${token}` },
      payload: command,
    });
  }
});
