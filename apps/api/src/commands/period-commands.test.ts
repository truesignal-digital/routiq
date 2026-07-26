import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import {
  approvalRules,
  financialPostings,
  postingPeriods,
} from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

describe("period commands", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let assetId: string;
  let approverToken: string;
  let submitterToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;

    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;
    const approver = await seedMember(db, {
      workspaceId,
      role: "FINANCE_APPROVER",
      allBranches: true,
    });
    const admin = await seedMember(db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    const submitter = await seedMember(db, {
      workspaceId,
      role: "FIELD_SUBMITTER",
      allBranches: true,
    });
    const [approverSession, adminSession, submitterSession] = await Promise.all([
      createSession(db, {
        principalId: approver.principal.id,
        workspaceId,
      }),
      createSession(db, {
        principalId: admin.principal.id,
        workspaceId,
      }),
      createSession(db, {
        principalId: submitter.principal.id,
        workspaceId,
      }),
    ]);
    approverToken = approverSession.token;
    submitterToken = submitterSession.token;
    assetId = await seedAsset(ctx.app, adminSession.token);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("Lock/reopen round-trip", async () => {
    const locked = await postCommand(
      approverToken,
      "lock-period",
      { periodCode: "2025-03" },
    );
    expect(locked.statusCode).toBe(200);
    expect(locked.json()).toMatchObject({
      recordStatus: "LOCKED",
      rowVersion: 2,
    });

    const reopened = await postCommand(
      approverToken,
      "reopen-period",
      { periodCode: "2025-03", reason: "month-end correction" },
      { expectedVersion: 2 },
    );
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toMatchObject({
      recordStatus: "OPEN",
      rowVersion: 3,
    });
  });

  it("State guards", async () => {
    const locked = await postCommand(
      approverToken,
      "lock-period",
      { periodCode: "2025-04" },
    );
    expect(locked.statusCode).toBe(200);

    const lockedAgain = await postCommand(
      approverToken,
      "lock-period",
      { periodCode: "2025-04" },
      { expectedVersion: 2 },
    );
    expect(lockedAgain.statusCode).toBe(409);
    expect(lockedAgain.json()).toMatchObject({
      error: { code: "INVALID_STATE_TRANSITION" },
    });

    const reopened = await postCommand(
      approverToken,
      "reopen-period",
      { periodCode: "2025-04", reason: "verify open-state guard" },
      { expectedVersion: 2 },
    );
    expect(reopened.statusCode).toBe(200);

    const reopenedAgain = await postCommand(
      approverToken,
      "reopen-period",
      { periodCode: "2025-04", reason: "already open" },
      { expectedVersion: 3 },
    );
    expect(reopenedAgain.statusCode).toBe(409);
    expect(reopenedAgain.json()).toMatchObject({
      error: { code: "INVALID_STATE_TRANSITION" },
    });

    const absent = await postCommand(
      approverToken,
      "reopen-period",
      { periodCode: "2025-12", reason: "missing period" },
      { expectedVersion: 1 },
    );
    expect(absent.statusCode).toBe(422);
    expect(absent.json()).toMatchObject({
      error: { code: "REFERENCE_NOT_FOUND" },
    });
  });

  it("Version handling on reopen", async () => {
    const locked = await postCommand(
      approverToken,
      "lock-period",
      { periodCode: "2025-05" },
    );
    expect(locked.statusCode).toBe(200);

    const missingVersion = await postCommand(
      approverToken,
      "reopen-period",
      { periodCode: "2025-05", reason: "missing version" },
    );
    expect(missingVersion.statusCode).toBe(400);
    expect(missingVersion.json()).toMatchObject({
      error: { code: "EXPECTED_VERSION_REQUIRED" },
    });

    const wrongVersion = await postCommand(
      approverToken,
      "reopen-period",
      { periodCode: "2025-05", reason: "stale version" },
      { expectedVersion: 99 },
    );
    expect(wrongVersion.statusCode).toBe(409);
    expect(wrongVersion.json()).toMatchObject({
      error: { code: "VERSION_CONFLICT" },
    });
  });

  it("Lock warns on SUBMITTED", async () => {
    await db
      .delete(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, workspaceId),
          eq(approvalRules.commandType, "record-expense"),
          isNull(approvalRules.categoryCode),
          isNull(approvalRules.branchId),
          isNull(approvalRules.amountMinMinor),
          isNull(approvalRules.amountMaxMinor),
        ),
      );

    const recorded = await recordExpense(
      approverToken,
      150_000,
      "2025-06-10",
    );
    expect(recorded.statusCode).toBe(200);
    expect(recorded.json()).toMatchObject({ recordStatus: "SUBMITTED" });

    const locked = await postCommand(
      approverToken,
      "lock-period",
      { periodCode: "2025-06" },
    );
    expect(locked.statusCode).toBe(200);
    expect(locked.json().warnings).toContain(
      "PERIOD_HAS_SUBMITTED_ENTRIES",
    );
  });

  it("Late posting with lock", async () => {
    const locked = await postCommand(
      approverToken,
      "lock-period",
      { periodCode: "2025-01" },
    );
    expect(locked.statusCode).toBe(200);

    const late = await recordExpense(
      submitterToken,
      40_000,
      "2025-01-10",
    );
    expect(late.statusCode).toBe(200);
    expect(late.json().warnings).toContain("LATE_POSTING");

    const reopened = await postCommand(
      approverToken,
      "reopen-period",
      { periodCode: "2025-01", reason: "accept corrected January posting" },
      { expectedVersion: 2 },
    );
    expect(reopened.statusCode).toBe(200);

    const onTime = await recordExpense(
      submitterToken,
      50_000,
      "2025-01-10",
    );
    expect(onTime.statusCode).toBe(200);
    expect(onTime.json().warnings).not.toContain("LATE_POSTING");
  });

  it("Trigger backstop", async () => {
    const entryId = randomUUID();
    const recorded = await recordExpense(
      submitterToken,
      30_000,
      "2025-02-10",
      entryId,
    );
    expect(recorded.statusCode).toBe(200);

    // Posting auto-created the 2025-02 row, so locking it is a mutation of an
    // existing period and requires optimistic concurrency.
    const missingVersion = await postCommand(
      approverToken,
      "lock-period",
      { periodCode: "2025-02" },
    );
    expect(missingVersion.statusCode).toBe(400);
    expect(missingVersion.json()).toMatchObject({
      error: { code: "EXPECTED_VERSION_REQUIRED" },
    });

    const staleVersion = await postCommand(
      approverToken,
      "lock-period",
      { periodCode: "2025-02" },
      { expectedVersion: 9 },
    );
    expect(staleVersion.statusCode).toBe(409);
    expect(staleVersion.json()).toMatchObject({
      error: { code: "VERSION_CONFLICT" },
    });

    const locked = await postCommand(
      approverToken,
      "lock-period",
      { periodCode: "2025-02" },
      { expectedVersion: 1 },
    );
    expect(locked.statusCode).toBe(200);

    const [period] = await db
      .select({ id: postingPeriods.id })
      .from(postingPeriods)
      .where(
        and(
          eq(postingPeriods.workspaceId, workspaceId),
          eq(postingPeriods.periodCode, "2025-02"),
        ),
      );
    const [sourcePosting] = await db
      .select()
      .from(financialPostings)
      .where(eq(financialPostings.financialEntryId, entryId));
    if (!period || !sourcePosting) {
      throw new Error("trigger test setup failed");
    }

    await expectDatabaseError(
      db.insert(financialPostings).values({
        workspaceId,
        financialEntryId: entryId,
        lineNo: 2,
        economicDate: sourcePosting.economicDate,
        postingPeriodId: period.id,
        direction: sourcePosting.direction,
        categoryId: sourcePosting.categoryId,
        branchId: sourcePosting.branchId,
        assetId: sourcePosting.assetId,
        amountMinor: 1n,
        assetAttribution: sourcePosting.assetAttribution,
        createdByCommandId: sourcePosting.createdByCommandId,
      }),
      /PERIOD_LOCKED/i,
    );
  });

  it("Role forbids", async () => {
    const response = await postCommand(
      submitterToken,
      "lock-period",
      { periodCode: "2025-07" },
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "ROLE_FORBIDDEN" },
    });
  });

  async function recordExpense(
    token: string,
    amountMinor: number,
    economicDate: string,
    entryId = randomUUID(),
  ) {
    return postCommand(token, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate,
      amountMinor,
      paymentMethod: "MOMO",
      paymentReference: `MOMO-${randomUUID()}`,
      postings: [{ assetId, amountMinor }],
    });
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
