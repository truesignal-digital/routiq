import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import {
  approvalRules,
  assets,
  auditEvents,
  commands,
  financialEntries,
  financialPostings,
  postingPeriods,
} from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import { currentPeriodCode } from "./periods.js";

describe("reverse-entry.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let assetId: string;
  let submitterToken: string;
  let approverToken: string;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;

    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;

    const submitter = await seedMember(db, {
      workspaceId,
      role: "DRIVER",
      allBranches: true,
    });
    const approver = await seedMember(db, {
      workspaceId,
      role: "FINANCE",
      allBranches: true,
    });
    const admin = await seedMember(db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    const [submitterSession, approverSession, adminSession] = await Promise.all([
      createSession(db, {
        principalId: submitter.principal.id,
        workspaceId,
      }),
      createSession(db, {
        principalId: approver.principal.id,
        workspaceId,
      }),
      createSession(db, {
        principalId: admin.principal.id,
        workspaceId,
      }),
    ]);
    submitterToken = submitterSession.token;
    approverToken = approverSession.token;
    adminToken = adminSession.token;
    assetId = await seedAsset();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("Happy path reversal", async () => {
    const { originalEntryId, reversalEntryId, response } =
      await recordAndReverse(60_000, "duplicate");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recordId: reversalEntryId,
      recordStatus: "POSTED",
      rowVersion: 1,
    });

    const [original, reversal] = await Promise.all([
      selectEntry(originalEntryId),
      selectEntry(reversalEntryId),
    ]);
    expect(reversal).toMatchObject({
      amountMinor: -60_000n,
      reversesEntryId: originalEntryId,
      status: "POSTED",
      direction: "EXPENSE",
      rowVersion: 1,
    });
    expect(reversal?.entryNumber).toMatch(/^DLA-\d{4}-\d{5}$/);
    expect(reversal?.entryNumber).not.toBe(original?.entryNumber);

    const reversalPostings = await db
      .select()
      .from(financialPostings)
      .where(
        and(
          eq(financialPostings.workspaceId, workspaceId),
          eq(financialPostings.financialEntryId, reversalEntryId),
        ),
      );
    expect(reversalPostings).toHaveLength(1);
    expect(
      reversalPostings.every(
        (posting) =>
          posting.amountMinor === -60_000n &&
          posting.postingPeriodId !== null,
      ),
    ).toBe(true);

    expect(original).toMatchObject({
      status: "REVERSED",
      rowVersion: 2,
      amountMinor: 60_000n,
    });

    const events = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.workspaceId, workspaceId),
          inArray(auditEvents.entityId, [originalEntryId, reversalEntryId]),
        ),
      );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: reversalEntryId,
          eventType: "financial_entry.reversal_posted",
        }),
        expect.objectContaining({
          entityId: originalEntryId,
          eventType: "financial_entry.reversed",
          afterState: expect.objectContaining({
            reversedByEntryId: reversalEntryId,
            reason: "duplicate",
          }),
        }),
      ]),
    );
  });

  it("Signed sum nets to zero (§4.2)", async () => {
    const { originalEntryId, reversalEntryId } =
      await recordAndReverse(60_000, "duplicate");
    const postings = await db
      .select({ amountMinor: financialPostings.amountMinor })
      .from(financialPostings)
      .where(
        and(
          eq(financialPostings.workspaceId, workspaceId),
          eq(financialPostings.assetId, assetId),
          inArray(financialPostings.financialEntryId, [
            originalEntryId,
            reversalEntryId,
          ]),
        ),
      );

    expect(
      postings.reduce((sum, posting) => sum + posting.amountMinor, 0n),
    ).toBe(0n);
  });

  it("Double-reverse blocked", async () => {
    const { originalEntryId } = await recordAndReverse(60_000, "duplicate");
    const secondAttempt = await postCommand(
      approverToken,
      "reverse-entry",
      {
        reversalEntryId: randomUUID(),
        originalEntryId,
        reason: "duplicate again",
      },
      { expectedVersion: 2 },
    );

    expect(secondAttempt.statusCode).toBe(409);
    expect(secondAttempt.json()).toMatchObject({
      error: {
        code: "ENTRY_ALREADY_REVERSED",
        metadata: { originalEntryId },
      },
    });
  });

  it("Cannot reverse SUBMITTED or REJECTED", async () => {
    const submitterRules = await db
      .select()
      .from(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, workspaceId),
          eq(approvalRules.commandType, "record-expense"),
          eq(approvalRules.requiredRole, "DRIVER"),
        ),
      );
    if (submitterRules.length > 0) {
      await db
        .update(commands)
        .set({ approvalRuleId: null })
        .where(
          inArray(
            commands.approvalRuleId,
            submitterRules.map((rule) => rule.id),
          ),
        );
    }
    await db
      .delete(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, workspaceId),
          eq(approvalRules.commandType, "record-expense"),
          eq(approvalRules.requiredRole, "DRIVER"),
        ),
      );

    try {
      const originalEntryId = randomUUID();
      const recorded = await recordExpense(originalEntryId, 150_000);
      expect(recorded.statusCode).toBe(200);
      expect(recorded.json()).toMatchObject({ recordStatus: "SUBMITTED" });

      const submittedAttempt = await postCommand(
        approverToken,
        "reverse-entry",
        {
          reversalEntryId: randomUUID(),
          originalEntryId,
          reason: "invalid submitted reversal",
        },
        { expectedVersion: 1 },
      );
      expect(submittedAttempt.statusCode).toBe(409);
      expect(submittedAttempt.json()).toMatchObject({
        error: {
          code: "INVALID_STATE_TRANSITION",
          metadata: { from: "SUBMITTED", to: "REVERSED" },
        },
      });

      const rejected = await postCommand(
        approverToken,
        "reject-entry",
        { entryId: originalEntryId, reason: "not valid" },
        { expectedVersion: 1 },
      );
      expect(rejected.statusCode).toBe(200);
      expect(rejected.json()).toMatchObject({
        recordStatus: "REJECTED",
        rowVersion: 2,
      });

      const rejectedAttempt = await postCommand(
        approverToken,
        "reverse-entry",
        {
          reversalEntryId: randomUUID(),
          originalEntryId,
          reason: "invalid rejected reversal",
        },
        { expectedVersion: 2 },
      );
      expect(rejectedAttempt.statusCode).toBe(409);
      expect(rejectedAttempt.json()).toMatchObject({
        error: {
          code: "INVALID_STATE_TRANSITION",
          metadata: { from: "REJECTED", to: "REVERSED" },
        },
      });
    } finally {
      if (submitterRules.length > 0) {
        await db.insert(approvalRules).values(submitterRules);
      }
    }
  });

  it("Late reversal", async () => {
    const currentCode = currentPeriodCode(new Date(), "Africa/Douala");
    const priorCode = previousPeriodCode(currentCode);
    const originalEntryId = randomUUID();
    const recorded = await recordExpense(
      originalEntryId,
      40_000,
      `${priorCode}-15`,
    );
    expect(recorded.statusCode).toBe(200);
    expect(recorded.json()).toMatchObject({ recordStatus: "POSTED" });

    const originalBefore = await selectEntry(originalEntryId);
    if (!originalBefore?.postingPeriodId) {
      throw new Error("posted original has no posting period");
    }
    await db
      .update(postingPeriods)
      .set({ status: "LOCKED", lockedAt: new Date() })
      .where(
        and(
          eq(postingPeriods.workspaceId, workspaceId),
          eq(postingPeriods.id, originalBefore.postingPeriodId),
        ),
      );

    const reversalEntryId = randomUUID();
    const reversed = await postCommand(
      approverToken,
      "reverse-entry",
      {
        reversalEntryId,
        originalEntryId,
        reason: "late correction",
      },
      { expectedVersion: 1 },
    );
    expect(reversed.statusCode).toBe(200);
    expect(reversed.json()).toMatchObject({
      recordStatus: "POSTED",
      warnings: ["LATE_POSTING"],
    });

    const [originalAfter, reversal] = await Promise.all([
      selectEntry(originalEntryId),
      selectEntry(reversalEntryId),
    ]);
    expect(originalAfter?.postingPeriodId).toBe(
      originalBefore.postingPeriodId,
    );
    expect(reversal).toMatchObject({ isLatePosting: true });
    const [reversalPeriod] = await db
      .select()
      .from(postingPeriods)
      .where(eq(postingPeriods.id, reversal?.postingPeriodId ?? randomUUID()));
    expect(reversalPeriod?.periodCode).toBe(currentCode);
  });

  it("Audit trail dual events", async () => {
    const { originalEntryId, reversalEntryId } =
      await recordAndReverse(60_000, "audit correction");
    const events = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.workspaceId, workspaceId),
          inArray(auditEvents.eventType, [
            "financial_entry.reversal_posted",
            "financial_entry.reversed",
          ]),
          inArray(auditEvents.entityId, [originalEntryId, reversalEntryId]),
        ),
      );

    const reversalPosted = events.find(
      (event) =>
        event.eventType === "financial_entry.reversal_posted" &&
        event.entityId === reversalEntryId,
    );
    const originalReversed = events.find(
      (event) =>
        event.eventType === "financial_entry.reversed" &&
        event.entityId === originalEntryId,
    );
    expect(reversalPosted?.afterState).toMatchObject({
      reversesEntryId: originalEntryId,
      reason: "audit correction",
      postings: [
        expect.objectContaining({
          financialEntryId: reversalEntryId,
          assetId,
          amountMinor: -60_000,
        }),
      ],
    });
    expect(originalReversed?.afterState).toMatchObject({
      reversedByEntryId: reversalEntryId,
      reason: "audit correction",
    });
  });

  async function seedAsset(): Promise<string> {
    const id = randomUUID();
    const response = await postCommand(adminToken, "register-asset", {
      assetId: id,
      assetCode: "REVERSE-ENTRY-ASSET",
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
    entryId: string,
    amountMinor: number,
    economicDate = `${currentPeriodCode(new Date(), "Africa/Douala")}-15`,
  ) {
    return postCommand(submitterToken, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate,
      amountMinor,
      paymentMethod: "CASH",
      postings: [{ assetId, amountMinor }],
    });
  }

  async function recordAndReverse(amountMinor: number, reason: string) {
    const originalEntryId = randomUUID();
    const recorded = await recordExpense(originalEntryId, amountMinor);
    expect(recorded.statusCode).toBe(200);
    expect(recorded.json()).toMatchObject({
      recordStatus: "POSTED",
      rowVersion: 1,
    });

    const reversalEntryId = randomUUID();
    const response = await postCommand(
      approverToken,
      "reverse-entry",
      { reversalEntryId, originalEntryId, reason },
      { expectedVersion: 1 },
    );
    expect(response.statusCode).toBe(200);
    return { originalEntryId, reversalEntryId, response };
  }

  async function selectEntry(entryId: string) {
    const [entry] = await db
      .select()
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.workspaceId, workspaceId),
          eq(financialEntries.id, entryId),
        ),
      );
    return entry;
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

function previousPeriodCode(periodCode: string): string {
  const [yearText, monthText] = periodCode.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}
