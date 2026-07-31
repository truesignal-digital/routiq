import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import {
  assets,
  auditEvents,
  branches,
  categories,
  financialEntries,
  financialPostings,
  postingPeriods,
} from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import { currentPeriodCode } from "./periods.js";

describe("record-expense.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let branchId: string;
  let token: string;
  let adminToken: string;
  let approverToken: string;
  let assetId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;

    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;
    branchId = seeded.branch.id;

    const admin = await seedMember(db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    const adminSession = await createSession(db, {
      principalId: admin.principal.id,
      workspaceId,
    });
    adminToken = adminSession.token;
    const submitter = await seedMember(db, {
      workspaceId,
      role: "FIELD_SUBMITTER",
      allBranches: true,
    });
    token = (
      await createSession(db, {
        principalId: submitter.principal.id,
        workspaceId,
      })
    ).token;
    const approver = await seedMember(db, {
      workspaceId,
      role: "FINANCE_APPROVER",
      allBranches: true,
    });
    approverToken = (
      await createSession(db, {
        principalId: approver.principal.id,
        workspaceId,
      })
    ).token;

    assetId = randomUUID();
    const assetResponse = await postCommand(
      adminSession.token,
      "register-asset",
      {
        assetId,
        assetCode: "FIN-TRUCK-001",
        assetClassCode: "TRUCK",
        templateCode: "TRUCKING",
        branchCode: "DLA",
      },
    );
    expect(assetResponse.statusCode).toBe(200);

  });

  afterAll(async () => {
    await ctx.close();
  });

  it("auto-posts an expense below threshold with signed postings and an evidence warning", async () => {
    const entryId = randomUUID();
    const commandId = randomUUID();
    const idempotencyKey = `idem-${randomUUID()}`;
    const payload = {
      entryId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-07-24",
      amountMinor: 75_000,
      paymentMethod: "CASH",
      postings: [{ assetId, amountMinor: 75_000 }],
    };
    const response = await postCommand(token, "record-expense", {
      ...payload,
    }, { commandId, idempotencyKey });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recordId: entryId,
      recordStatus: "POSTED",
      rowVersion: 1,
      warnings: ["EVIDENCE_MISSING"],
      idempotentReplay: false,
    });

    const [entry] = await db
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.id, entryId));
    expect(entry).toMatchObject({
      workspaceId,
      direction: "EXPENSE",
      economicDate: "2026-07-24",
      branchId,
      amountMinor: 75_000n,
      currency: "XAF",
      status: "POSTED",
      isLatePosting: false,
      rowVersion: 1,
    });
    expect(entry?.entryNumber).toMatch(/^DLA-2026-\d{5}$/);
    expect(entry?.postingPeriodId).not.toBeNull();
    expect(entry?.postedAt).toBeInstanceOf(Date);

    const postings = await db
      .select()
      .from(financialPostings)
      .where(eq(financialPostings.financialEntryId, entryId));
    expect(postings).toHaveLength(1);
    expect(postings[0]).toMatchObject({
      workspaceId,
      lineNo: 1,
      economicDate: "2026-07-24",
      direction: "EXPENSE",
      branchId,
      assetId,
      amountMinor: 75_000n,
      assetAttribution: "DIRECT",
      postingPeriodId: entry?.postingPeriodId,
    });
    expect(
      postings.reduce((sum, posting) => sum + posting.amountMinor, 0n),
    ).toBe(entry?.amountMinor);

    const [period] = await db
      .select()
      .from(postingPeriods)
      .where(eq(postingPeriods.id, entry?.postingPeriodId ?? randomUUID()));
    expect(period).toMatchObject({
      workspaceId,
      periodCode: "2026-07",
      status: "OPEN",
    });

    const [audit] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityType, "financial_entry"),
          eq(auditEvents.entityId, entryId),
        ),
      );
    expect(audit).toMatchObject({ eventType: "financial_entry.posted" });
    expect(audit?.afterState).toMatchObject({
      id: entryId,
      paymentMethod: "CASH",
      paymentReference: null,
      estimateStatus: "ACTUAL",
      status: "POSTED",
      createdByCommandId: commandId,
      postings: [
        expect.objectContaining({
          financialEntryId: entryId,
          assetId,
          amountMinor: 75_000,
        }),
      ],
    });

    const replay = await postCommand(
      token,
      "record-expense",
      payload,
      { commandId, idempotencyKey },
    );
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      recordId: entryId,
      recordStatus: "POSTED",
      warnings: ["EVIDENCE_MISSING"],
      idempotentReplay: true,
    });
    expect(
      await db
        .select()
        .from(financialEntries)
        .where(eq(financialEntries.id, entryId)),
    ).toHaveLength(1);
  });

  it("stores an above-threshold expense as SUBMITTED without resolving a period", async () => {
    const entryId = randomUUID();
    const response = await postCommand(token, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-08-02",
      amountMinor: 100_001,
      paymentMethod: "MOMO",
      paymentReference: "MOMO-123",
      postings: [{ assetId, amountMinor: 100_001 }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recordId: entryId,
      recordStatus: "SUBMITTED",
      warnings: [],
    });

    const [entry] = await db
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.id, entryId));
    expect(entry).toMatchObject({
      status: "SUBMITTED",
      postingPeriodId: null,
      postedAt: null,
      isLatePosting: false,
    });
    const postings = await db
      .select()
      .from(financialPostings)
      .where(eq(financialPostings.financialEntryId, entryId));
    expect(postings).toHaveLength(1);
    expect(postings[0]?.postingPeriodId).toBeNull();
  });

  it("lets a finance approver auto-post above threshold under the catalog wildcard", async () => {
    const entryId = randomUUID();
    const response = await postCommand(approverToken, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-08-02",
      amountMinor: 250_000,
      paymentMethod: "OM",
      paymentReference: "OM-250000",
      postings: [{ assetId, amountMinor: 250_000 }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recordId: entryId,
      recordStatus: "POSTED",
      warnings: [],
    });
  });

  it("late-posts into the current open month when the economic month is locked", async () => {
    const currentCode = currentPeriodCode(new Date(), "Africa/Douala");
    const priorCode = previousPeriodCode(currentCode);
    const [asset] = await db
      .select({ createdByCommandId: assets.createdByCommandId })
      .from(assets)
      .where(eq(assets.id, assetId));
    if (!asset) throw new Error("seed asset not found");
    await db
      .insert(postingPeriods)
      .values({
        workspaceId,
        periodCode: priorCode,
        status: "LOCKED",
        lockedAt: new Date(),
        createdByCommandId: asset.createdByCommandId,
      })
      .onConflictDoUpdate({
        target: [postingPeriods.workspaceId, postingPeriods.periodCode],
        set: { status: "LOCKED", lockedAt: new Date() },
      });

    const entryId = randomUUID();
    const response = await postCommand(token, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: `${priorCode}-15`,
      amountMinor: 10_000,
      paymentMethod: "CASH",
      postings: [{ assetId, amountMinor: 10_000 }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recordStatus: "POSTED",
      warnings: ["EVIDENCE_MISSING", "LATE_POSTING"],
    });
    const [entry] = await db
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.id, entryId));
    expect(entry).toMatchObject({
      economicDate: `${priorCode}-15`,
      isLatePosting: true,
      status: "POSTED",
    });
    const [period] = await db
      .select()
      .from(postingPeriods)
      .where(eq(postingPeriods.id, entry?.postingPeriodId ?? randomUUID()));
    expect(period?.periodCode).toBe(currentCode);
  });

  it("rejects a posting total that does not equal the entry amount", async () => {
    const entryId = randomUUID();
    const response = await postCommand(token, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-07-24",
      amountMinor: 75_000,
      paymentMethod: "CASH",
      postings: [
        { assetId, amountMinor: 50_000 },
        { assetId, amountMinor: 20_000 },
      ],
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: "POSTINGS_SUM_MISMATCH",
        metadata: { entryAmountMinor: 75_000, postingsAmountMinor: 70_000 },
      },
    });
    expect(
      await db
        .select()
        .from(financialEntries)
        .where(eq(financialEntries.id, entryId)),
    ).toHaveLength(0);
  });

  it("allocates unique sequential entry numbers under concurrent writes", async () => {
    const entryIds = [randomUUID(), randomUUID()];
    const responses = await Promise.all(
      entryIds.map((entryId) =>
        postCommand(token, "record-expense", {
          entryId,
          branchCode: "DLA",
          categoryCode: "PARKING",
          economicDate: "2027-01-10",
          amountMinor: 2_000,
          paymentMethod: "CASH",
          postings: [{ assetId, amountMinor: 2_000 }],
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(responses.map((response) => response.json().warnings)).toEqual([[], []]);

    const rows = await db
      .select({ entryNumber: financialEntries.entryNumber })
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.workspaceId, workspaceId),
          eq(financialEntries.economicDate, "2027-01-10"),
        ),
      );
    const sequences = rows
      .map((row) => Number(row.entryNumber.slice(-5)))
      .sort((left, right) => left - right);
    expect(new Set(rows.map((row) => row.entryNumber)).size).toBe(2);
    expect(sequences[1]).toBe((sequences[0] ?? 0) + 1);
  });

  it("keeps posted entry facts and posting lines immutable in the database", async () => {
    const entryId = randomUUID();
    const response = await postCommand(token, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-09-01",
      amountMinor: 5_000,
      paymentMethod: "CASH",
      postings: [{ assetId, amountMinor: 5_000 }],
    });
    expect(response.statusCode).toBe(200);

    await expectDatabaseError(
      db
        .update(financialEntries)
        .set({ amountMinor: 6_000n })
        .where(eq(financialEntries.id, entryId)),
      /economic facts are immutable/i,
    );
    await expectDatabaseError(
      db
        .update(financialPostings)
        .set({ amountMinor: 6_000n })
        .where(eq(financialPostings.financialEntryId, entryId)),
      /financial postings are immutable/i,
    );
    const [entry] = await db
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.id, entryId));
    expect(entry?.amountMinor).toBe(5_000n);

    if (!entry) throw new Error("posted entry missing");
    const [otherPeriod] = await db
      .insert(postingPeriods)
      .values({
        workspaceId,
        periodCode: "2031-01",
        createdByCommandId: entry.createdByCommandId,
      })
      .returning();
    if (!otherPeriod) throw new Error("period insert returned no row");
    await expectDatabaseError(
      db
        .update(financialPostings)
        .set({ postingPeriodId: otherPeriod.id })
        .where(eq(financialPostings.financialEntryId, entryId)),
      /posting period may be assigned exactly once/i,
    );
  });

  it("does not treat cash references as evidence and suppresses warnings for declared no-receipt costs", async () => {
    const cash = await postCommand(token, "record-expense", {
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-10-01",
      amountMinor: 3_000,
      paymentMethod: "CASH",
      paymentReference: "handwritten-note",
      postings: [{ assetId, amountMinor: 3_000 }],
    });
    expect(cash.statusCode).toBe(200);
    expect(cash.json().warnings).toEqual(["EVIDENCE_MISSING"]);

    const bank = await postCommand(token, "record-expense", {
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-10-01",
      amountMinor: 4_000,
      paymentMethod: "BANK",
      paymentReference: "BANK-TRANSFER-42",
      postings: [{ assetId, amountMinor: 4_000 }],
    });
    expect(bank.statusCode).toBe(200);
    expect(bank.json().warnings).toEqual([]);

    const parkingEntryId = randomUUID();
    const parking = await postCommand(token, "record-expense", {
      entryId: parkingEntryId,
      branchCode: "DLA",
      categoryCode: "PARKING",
      economicDate: "2026-10-01",
      amountMinor: 500,
      paymentMethod: "CASH",
      postings: [{ amountMinor: 500 }],
    });
    expect(parking.statusCode).toBe(200);
    expect(parking.json().warnings).toEqual([]);
    const [parkingAudit] = await db
      .select({ afterState: auditEvents.afterState })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, parkingEntryId));
    expect(parkingAudit?.afterState).toMatchObject({
      postings: [expect.objectContaining({ assetId: null })],
    });
  });

  it("rejects a category of the wrong financial direction", async () => {
    const response = await postCommand(token, "record-expense", {
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "TRUCK",
      economicDate: "2026-07-24",
      amountMinor: 1_000,
      paymentMethod: "CASH",
      postings: [{ assetId, amountMinor: 1_000 }],
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: "CATEGORY_KIND_MISMATCH",
        metadata: { categoryCode: "TRUCK", expectedKind: "EXPENSE_CATEGORY" },
      },
    });
  });

  it("keeps cross-tenant branches, categories, assets, and period commands invisible", async () => {
    const other = await seedWorkspace(db);
    const otherAdmin = await seedMember(db, {
      workspaceId: other.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    const otherToken = (
      await createSession(db, {
        principalId: otherAdmin.principal.id,
        workspaceId: other.workspace.id,
      })
    ).token;
    await db.insert(categories).values({
      workspaceId: other.workspace.id,
      kind: "EXPENSE_CATEGORY",
      code: "OTHER_TENANT_ONLY",
      labelFr: "Autre locataire",
      labelEn: "Other tenant",
      profitabilityLayer: "DIRECT",
    });
    await db.insert(branches).values({
      workspaceId: other.workspace.id,
      code: "BAF",
      name: "Bafoussam",
    });
    const otherAssetId = randomUUID();
    const otherCommandId = randomUUID();
    const registered = await postCommand(
      otherToken,
      "register-asset",
      {
        assetId: otherAssetId,
        assetCode: "OTHER-TRUCK",
        assetClassCode: "TRUCK",
        templateCode: "TRUCKING",
        branchCode: "DLA",
      },
      { commandId: otherCommandId },
    );
    expect(registered.statusCode).toBe(200);

    const foreignAsset = await postCommand(token, "record-expense", {
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-07-24",
      amountMinor: 1_000,
      paymentMethod: "CASH",
      postings: [{ assetId: otherAssetId, amountMinor: 1_000 }],
    });
    expect(foreignAsset.statusCode).toBe(422);
    expect(foreignAsset.json()).toMatchObject({
      error: { code: "REFERENCE_NOT_FOUND", metadata: { referenceType: "asset" } },
    });

    const foreignCategory = await postCommand(token, "record-expense", {
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "OTHER_TENANT_ONLY",
      economicDate: "2026-07-24",
      amountMinor: 1_000,
      paymentMethod: "CASH",
      postings: [{ assetId, amountMinor: 1_000 }],
    });
    expect(foreignCategory.statusCode).toBe(422);
    expect(foreignCategory.json()).toMatchObject({
      error: {
        code: "REFERENCE_NOT_FOUND",
        metadata: { referenceType: "expenseCategory" },
      },
    });

    const foreignBranch = await postCommand(token, "record-expense", {
      entryId: randomUUID(),
      branchCode: "BAF",
      categoryCode: "FUEL",
      economicDate: "2026-07-24",
      amountMinor: 1_000,
      paymentMethod: "CASH",
      postings: [{ assetId, amountMinor: 1_000 }],
    });
    expect(foreignBranch.statusCode).toBe(422);
    expect(foreignBranch.json()).toMatchObject({
      error: { code: "REFERENCE_NOT_FOUND", metadata: { referenceType: "branch" } },
    });

    const [localAsset] = await db
      .select({ createdByCommandId: assets.createdByCommandId })
      .from(assets)
      .where(eq(assets.id, assetId));
    if (!localAsset) throw new Error("local asset missing");
    await expectDatabaseError(
      db.insert(postingPeriods).values({
        workspaceId,
        periodCode: "2030-01",
        status: "LOCKED",
        lockedByCommandId: otherCommandId,
        createdByCommandId: localAsset.createdByCommandId,
      }),
      /foreign key|posting_periods_ws_locked_command_fk/i,
    );
  });

  it("rejects terminal and missing posting assets", async () => {
    await db
      .update(assets)
      .set({ lifecycleStatus: "SOLD" })
      .where(eq(assets.id, assetId));

    const terminal = await postCommand(token, "record-expense", {
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-07-24",
      amountMinor: 1_000,
      paymentMethod: "CASH",
      postings: [{ assetId, amountMinor: 1_000 }],
    });
    expect(terminal.statusCode).toBe(409);
    expect(terminal.json()).toMatchObject({
      error: { code: "ASSET_NOT_OPERATIONAL" },
    });

    const missingAssetId = randomUUID();
    const missing = await postCommand(token, "record-expense", {
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-07-24",
      amountMinor: 1_000,
      paymentMethod: "CASH",
      postings: [{ assetId: missingAssetId, amountMinor: 1_000 }],
    });
    expect(missing.statusCode).toBe(422);
    expect(missing.json()).toMatchObject({
      error: {
        code: "REFERENCE_NOT_FOUND",
        metadata: { referenceType: "asset", missing: [missingAssetId] },
      },
    });

    await db
      .update(assets)
      .set({ lifecycleStatus: "IN_SERVICE" })
      .where(eq(assets.id, assetId));
  });

  it("enforces the FINANCE module and the actor's branch scope", async () => {
    const disable = await postCommand(adminToken, "disable-module", {
      moduleCode: "FINANCE",
    });
    expect(disable.statusCode).toBe(200);
    const disabled = await postCommand(token, "record-expense", {
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-07-24",
      amountMinor: 1_000,
      paymentMethod: "CASH",
      postings: [{ assetId, amountMinor: 1_000 }],
    });
    expect(disabled.statusCode).toBe(403);
    expect(disabled.json()).toMatchObject({
      error: { code: "MODULE_DISABLED", metadata: { module: "FINANCE" } },
    });
    const enable = await postCommand(adminToken, "enable-module", {
      moduleCode: "FINANCE",
    });
    expect(enable.statusCode).toBe(200);

    const [otherBranch] = await db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();
    if (!otherBranch) throw new Error("branch insert returned no row");
    const otherBranchAssetId = randomUUID();
    const registered = await postCommand(adminToken, "register-asset", {
      assetId: otherBranchAssetId,
      assetCode: "FIN-YDE-001",
      assetClassCode: "TRUCK",
      templateCode: "TRUCKING",
      branchCode: "YDE",
    });
    expect(registered.statusCode).toBe(200);
    const scopedMember = await seedMember(db, {
      workspaceId,
      role: "FIELD_SUBMITTER",
      branchIds: [branchId],
    });
    const scopedToken = (
      await createSession(db, {
        principalId: scopedMember.principal.id,
        workspaceId,
      })
    ).token;

    const forbiddenEntryBranch = await postCommand(scopedToken, "record-expense", {
      entryId: randomUUID(),
      branchCode: "YDE",
      categoryCode: "FUEL",
      economicDate: "2026-07-24",
      amountMinor: 1_000,
      paymentMethod: "CASH",
      postings: [{ assetId, amountMinor: 1_000 }],
    });
    expect(forbiddenEntryBranch.statusCode).toBe(403);
    expect(forbiddenEntryBranch.json()).toMatchObject({
      error: { code: "ROLE_FORBIDDEN" },
    });

    const forbiddenPostingAsset = await postCommand(scopedToken, "record-expense", {
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-07-24",
      amountMinor: 1_000,
      paymentMethod: "CASH",
      postings: [{ assetId: otherBranchAssetId, amountMinor: 1_000 }],
    });
    expect(forbiddenPostingAsset.statusCode).toBe(403);
    expect(forbiddenPostingAsset.json()).toMatchObject({
      error: { code: "ROLE_FORBIDDEN" },
    });
  });

  it("attributes a posting to an activity when the payload names one", async () => {
    const activityId = randomUUID();
    const created = await postCommand(adminToken, "create-activity", {
      activityId,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      primarySegmentId: randomUUID(),
      primaryAssetId: assetId,
      startedAt: "2026-07-24T06:00:00Z",
    });
    expect(created.statusCode).toBe(200);

    const entryId = randomUUID();
    const response = await postCommand(token, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-07-24",
      amountMinor: 40_000,
      paymentMethod: "CASH",
      postings: [{ assetId, activityId, amountMinor: 40_000 }],
    });
    expect(response.statusCode).toBe(200);

    const postings = await db
      .select()
      .from(financialPostings)
      .where(eq(financialPostings.financialEntryId, entryId));
    expect(postings).toHaveLength(1);
    // Both dimensions on one line: the truck that burned the fuel and the job it
    // burned it on. §4.2 keeps one canonical posting per economic fact.
    expect(postings[0]).toMatchObject({
      assetId,
      activityId,
      amountMinor: 40_000n,
      assetAttribution: "DIRECT",
      activityAttribution: "DIRECT",
    });
  });

  it("refuses an activityId the workspace does not know", async () => {
    const response = await postCommand(token, "record-expense", {
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-07-24",
      amountMinor: 12_000,
      paymentMethod: "CASH",
      postings: [{ assetId, activityId: randomUUID(), amountMinor: 12_000 }],
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: "REFERENCE_NOT_FOUND",
        metadata: { referenceType: "activity" },
      },
    });
  });

  async function postCommand(
    authToken: string,
    name: string,
    payload: Record<string, unknown>,
    envelope: { commandId?: string; idempotencyKey?: string } = {},
  ) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        name,
        version: 1,
        envelope: {
          commandId: envelope.commandId ?? randomUUID(),
          idempotencyKey: envelope.idempotencyKey ?? `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload,
      },
    });
  }
});

function previousPeriodCode(periodCode: string): string {
  const [yearText, monthText] = periodCode.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const prior = new Date(Date.UTC(year, month - 2, 1));
  return `${prior.getUTCFullYear()}-${String(prior.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function expectDatabaseError(
  operation: Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    const messages: string[] = [];
    let current: unknown = error;
    while (current !== null && typeof current === "object") {
      if ("message" in current && typeof current.message === "string") {
        messages.push(current.message);
      }
      current = "cause" in current ? current.cause : undefined;
    }
    expect(messages.join("\n")).toMatch(pattern);
    return;
  }
  throw new Error("expected database operation to fail");
}
