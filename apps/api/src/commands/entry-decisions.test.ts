import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import {
  approvalRules,
  assets,
  auditEvents,
  branches,
  financialEntries,
  financialPostings,
  postingPeriods,
} from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import { currentPeriodCode } from "./periods.js";

describe("entry decisions", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let assetId: string;
  let submitterToken: string;
  let approverAToken: string;
  let approverBToken: string;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;

    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;
    await db
      .insert(branches)
      .values({ workspaceId, code: "CME", name: "Cemac" });

    const submitter = await seedMember(db, {
      workspaceId,
      role: "DRIVER",
      allBranches: true,
    });
    // The entries here are above the recording band, which Direction decides.
    const approverA = await seedMember(db, {
      workspaceId,
      role: "DIRECTOR",
      allBranches: true,
    });
    const approverB = await seedMember(db, {
      workspaceId,
      role: "DIRECTOR",
      allBranches: true,
    });
    const admin = await seedMember(db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });

    const [submitterSession, approverASession, approverBSession, adminSession] =
      await Promise.all([
        createSession(db, {
          principalId: submitter.principal.id,
          workspaceId,
        }),
        createSession(db, {
          principalId: approverA.principal.id,
          workspaceId,
        }),
        createSession(db, {
          principalId: approverB.principal.id,
          workspaceId,
        }),
        createSession(db, {
          principalId: admin.principal.id,
          workspaceId,
        }),
      ]);
    submitterToken = submitterSession.token;
    approverAToken = approverASession.token;
    approverBToken = approverBSession.token;
    adminToken = adminSession.token;

    assetId = await seedAsset();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("happy approve", async () => {
    const { entryId, response: recorded } = await recordExpense(
      submitterToken,
      150_000,
    );
    expect(recorded.statusCode).toBe(200);
    expect(recorded.json()).toMatchObject({ recordStatus: "SUBMITTED" });

    const approved = await postDecision(
      {
        name: "approve-entry",
        entryId,
        expectedVersion: 1,
        note: "reviewed",
      },
      approverAToken,
    );

    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({
      recordStatus: "POSTED",
      rowVersion: 2,
      warnings: [],
    });

    const [entry] = await db
      .select()
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.workspaceId, workspaceId),
          eq(financialEntries.id, entryId),
        ),
      );
    expect(entry).toMatchObject({
      status: "POSTED",
      isLatePosting: false,
      rowVersion: 2,
    });
    expect(entry?.postingPeriodId).not.toBeNull();
    expect(entry?.postedAt).toBeInstanceOf(Date);

    const postings = await db
      .select()
      .from(financialPostings)
      .where(
        and(
          eq(financialPostings.workspaceId, workspaceId),
          eq(financialPostings.financialEntryId, entryId),
        ),
      );
    expect(postings.length).toBeGreaterThan(0);
    expect(
      postings.every(
        (posting) => posting.postingPeriodId === entry?.postingPeriodId,
      ),
    ).toBe(true);

    const [audit] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.workspaceId, workspaceId),
          eq(auditEvents.entityId, entryId),
          eq(auditEvents.eventType, "financial_entry.approved"),
        ),
      );
    expect(audit?.afterState).toMatchObject({
      rowVersion: 2,
      approvalNote: "reviewed",
    });
  });

  it("maker cannot approve", async () => {
    await db
      .delete(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, workspaceId),
          eq(approvalRules.commandType, "record-expense"),
          isNull(approvalRules.amountMaxMinor),
        ),
      );

    const { entryId, response: recorded } = await recordExpense(
      approverAToken,
      150_000,
    );
    expect(recorded.statusCode).toBe(200);
    expect(recorded.json()).toMatchObject({ recordStatus: "SUBMITTED" });

    const makerAttempt = await postDecision(
      { name: "approve-entry", entryId, expectedVersion: 1 },
      approverAToken,
    );
    expect(makerAttempt.statusCode).toBe(403);
    expect(makerAttempt.json()).toMatchObject({
      error: { code: "MAKER_CANNOT_APPROVE" },
    });

    const approved = await postDecision(
      { name: "approve-entry", entryId, expectedVersion: 1 },
      approverBToken,
    );
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ recordStatus: "POSTED" });
  });

  it("approve non-SUBMITTED rejects", async () => {
    const { entryId } = await recordExpense(submitterToken, 150_000);
    const approved = await postDecision(
      { name: "approve-entry", entryId, expectedVersion: 1 },
      approverAToken,
    );
    expect(approved.statusCode).toBe(200);

    const secondApproval = await postDecision(
      { name: "approve-entry", entryId, expectedVersion: 2 },
      approverAToken,
    );
    expect(secondApproval.statusCode).toBe(409);
    expect(secondApproval.json()).toMatchObject({
      error: {
        code: "INVALID_STATE_TRANSITION",
        metadata: { from: "POSTED", to: "POSTED" },
      },
    });
  });

  it("reject stores reason", async () => {
    const { entryId } = await recordExpense(submitterToken, 150_000);
    const rejected = await postDecision(
      {
        name: "reject-entry",
        entryId,
        expectedVersion: 1,
        reason: "duplicate claim",
      },
      approverAToken,
    );

    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({
      recordStatus: "REJECTED",
      rowVersion: 2,
      warnings: [],
    });

    const [entry] = await db
      .select()
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.workspaceId, workspaceId),
          eq(financialEntries.id, entryId),
        ),
      );
    expect(entry).toMatchObject({
      status: "REJECTED",
      rejectedReason: "duplicate claim",
      postingPeriodId: null,
      rowVersion: 2,
    });

    const postings = await db
      .select()
      .from(financialPostings)
      .where(
        and(
          eq(financialPostings.workspaceId, workspaceId),
          eq(financialPostings.financialEntryId, entryId),
        ),
      );
    expect(postings.length).toBeGreaterThan(0);
    expect(
      postings.every((posting) => posting.postingPeriodId === null),
    ).toBe(true);

    const [audit] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.workspaceId, workspaceId),
          eq(auditEvents.entityId, entryId),
          eq(auditEvents.eventType, "financial_entry.rejected"),
        ),
      );
    expect(audit?.afterState).toMatchObject({
      rejectedReason: "duplicate claim",
    });
  });

  it("version handling", async () => {
    const { entryId } = await recordExpense(submitterToken, 150_000);

    const missingVersion = await postDecision(
      { name: "approve-entry", entryId },
      approverAToken,
    );
    expect(missingVersion.statusCode).toBe(400);
    expect(missingVersion.json()).toMatchObject({
      error: { code: "EXPECTED_VERSION_REQUIRED" },
    });

    const staleVersion = await postDecision(
      { name: "approve-entry", entryId, expectedVersion: 7 },
      approverAToken,
    );
    expect(staleVersion.statusCode).toBe(409);
    expect(staleVersion.json()).toMatchObject({
      error: { code: "VERSION_CONFLICT" },
    });
  });

  it("late approval", async () => {
    const currentCode = currentPeriodCode(new Date(), "Africa/Douala");
    const priorCode = previousPeriodCode(currentCode);
    const { entryId } = await recordExpense(
      submitterToken,
      150_000,
      `${priorCode}-15`,
    );
    const [entryBeforeApproval] = await db
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.id, entryId));
    if (!entryBeforeApproval) throw new Error("submitted entry not found");

    await db
      .insert(postingPeriods)
      .values({
        workspaceId,
        periodCode: priorCode,
        status: "LOCKED",
        lockedAt: new Date(),
        createdByCommandId: entryBeforeApproval.createdByCommandId,
      })
      .onConflictDoUpdate({
        target: [postingPeriods.workspaceId, postingPeriods.periodCode],
        set: { status: "LOCKED", lockedAt: new Date() },
      });

    const approved = await postDecision(
      { name: "approve-entry", entryId, expectedVersion: 1 },
      approverAToken,
    );
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({
      recordStatus: "POSTED",
      warnings: ["LATE_POSTING"],
    });

    const [entry] = await db
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.id, entryId));
    expect(entry).toMatchObject({ isLatePosting: true });
    const [period] = await db
      .select()
      .from(postingPeriods)
      .where(eq(postingPeriods.id, entry?.postingPeriodId ?? randomUUID()));
    expect(period?.periodCode).toBe(currentCode);
  });

  it("POSTED-only sums exclude rejected", async () => {
    await db
      .delete(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, workspaceId),
          eq(approvalRules.commandType, "record-expense"),
          eq(approvalRules.requiredRole, "DRIVER"),
        ),
      );

    const postedExpense = await recordExpense(submitterToken, 50_000);
    const approved = await postDecision(
      {
        name: "approve-entry",
        entryId: postedExpense.entryId,
        expectedVersion: 1,
      },
      approverAToken,
    );
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ recordStatus: "POSTED" });

    const rejectedExpense = await recordExpense(submitterToken, 30_000);
    const rejected = await postDecision(
      {
        name: "reject-entry",
        entryId: rejectedExpense.entryId,
        expectedVersion: 1,
        reason: "not reimbursable",
      },
      approverAToken,
    );
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({ recordStatus: "REJECTED" });

    const [result] = await db
      .select({
        total: sql<number>`coalesce(sum(${financialEntries.amountMinor}), 0)::integer`,
      })
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.workspaceId, workspaceId),
          eq(financialEntries.status, "POSTED"),
          sql`${financialEntries.id} in (${postedExpense.entryId}, ${rejectedExpense.entryId})`,
        ),
      );
    expect(result?.total).toBe(50_000);
  });

  async function seedAsset(): Promise<string> {
    const id = randomUUID();
    const response = await postCommand(adminToken, "register-asset", {
      assetId: id,
      assetCode: "ENTRY-DECISION-ASSET",
      assetClassCode: "TRUCK",
      templateCode: "TRUCKING",
      branchCode: "DLA",
    });
    expect(response.statusCode).toBe(200);

    const [asset] = await db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.id, id));
    if (!asset) throw new Error("seed asset not found");
    return asset.id;
  }

  async function recordExpense(
    token: string,
    amountMinor: number,
    economicDate = `${currentPeriodCode(new Date(), "Africa/Douala")}-15`,
  ) {
    const entryId = randomUUID();
    const response = await postCommand(token, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate,
      amountMinor,
      paymentMethod: "MOMO",
      paymentReference: `MOMO-${randomUUID()}`,
      postings: [{ assetId, amountMinor }],
    });
    return { entryId, response };
  }

  async function postDecision(
    command: DecisionCommand,
    deciderToken: string,
  ) {
    const { name, entryId, expectedVersion, ...decisionPayload } = command;
    return postCommand(
      deciderToken,
      name,
      { entryId, ...decisionPayload },
      expectedVersion === undefined ? {} : { expectedVersion },
    );
  }

  async function postCommand(
    token: string,
    name: string,
    payload: Record<string, unknown>,
    envelope: { expectedVersion?: number } = {},
  ) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name,
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
          ...(envelope.expectedVersion === undefined
            ? {}
            : { expectedVersion: envelope.expectedVersion }),
        },
        payload,
      },
    });
  }
});

type DecisionCommand =
  | {
      name: "approve-entry";
      entryId: string;
      expectedVersion?: number;
      note?: string;
    }
  | {
      name: "reject-entry";
      entryId: string;
      expectedVersion?: number;
      reason: string;
    };

function previousPeriodCode(periodCode: string): string {
  const [yearText, monthText] = periodCode.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}
