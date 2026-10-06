import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { auditEvents, financialEntries } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";
import { currentPeriodCode } from "./periods.js";

/**
 * Cancel entry (#426): reverse-entry.v2 takes a reason from a short list, kept
 * on the cancellation row and shown in words. v1 keeps working as OTHER.
 */
describe("reverse-entry.v2 (Cancel entry)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let financeToken: string;
  let driverToken: string;
  let assetId: string;
  const economicDate = `${currentPeriodCode(new Date(), "Africa/Douala")}-15`;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
    workspaceId = (await seedWorkspace(db)).workspace.id;
    const session = async (role: "ADMIN" | "FINANCE" | "DRIVER") => {
      const member = await seedMember(db, { workspaceId, role, allBranches: true });
      return (await createSession(db, { workspaceId, principalId: member.principal.id })).token;
    };
    const adminToken = await session("ADMIN");
    financeToken = await session("FINANCE");
    driverToken = await session("DRIVER");
    assetId = await seedAsset(ctx.app, adminToken);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("keeps a listed reason as its code, with no text, on the cancellation", async () => {
    const { originalEntryId, reversalEntryId, response } = await recordAndCancel(2, {
      reasonCode: "WRONG_DETAILS",
    });
    expect(response.statusCode).toBe(200);

    expect(await selectReason(reversalEntryId)).toEqual({
      reversalReasonCode: "WRONG_DETAILS",
      reversalReasonText: null,
    });
    expect(await selectReason(originalEntryId)).toEqual({
      reversalReasonCode: null,
      reversalReasonText: null,
    });

    const events = await db
      .select({ entityId: auditEvents.entityId, eventType: auditEvents.eventType, afterState: auditEvents.afterState })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.workspaceId, workspaceId),
          inArray(auditEvents.entityId, [originalEntryId, reversalEntryId]),
          inArray(auditEvents.eventType, ["financial_entry.reversed", "financial_entry.reversal_posted"]),
        ),
      );
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.afterState).toMatchObject({ reasonCode: "WRONG_DETAILS", reason: null });
    }
  });

  it("shows the reason on both the cancelled entry and its cancellation", async () => {
    const { originalEntryId, reversalEntryId } = await recordAndCancel(2, {
      reasonCode: "ENTERED_TWICE",
    });
    for (const id of [originalEntryId, reversalEntryId]) {
      const detail = await ctx.app.inject({
        method: "GET",
        url: `/v1/finance/entries/${id}`,
        headers: { authorization: `Bearer ${financeToken}` },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({
        cancellation: { reasonCode: "ENTERED_TWICE", reasonText: null },
      });
    }

    const uncancelled = randomUUID();
    expect((await recordExpense(uncancelled)).statusCode).toBe(200);
    const detail = await ctx.app.inject({
      method: "GET",
      url: `/v1/finance/entries/${uncancelled}`,
      headers: { authorization: `Bearer ${financeToken}` },
    });
    expect(detail.json()).toMatchObject({ cancellation: null });
  });

  it("puts the reason code on the history lines, for the client to word", async () => {
    const { originalEntryId } = await recordAndCancel(2, { reasonCode: "DID_NOT_HAPPEN" });
    const history = await ctx.app.inject({
      method: "GET",
      url: `/v1/history/financial_entry/${originalEntryId}`,
      headers: { authorization: `Bearer ${financeToken}` },
    });
    expect(history.statusCode).toBe(200);
    const items = history.json().items as Array<{ eventType: string; note: string | null; noteCode: string | null }>;
    expect(items.find((item) => item.eventType === "financial_entry.reversed")).toMatchObject({
      note: null,
      noteCode: "DID_NOT_HAPPEN",
    });
  });

  it("keeps the text for OTHER", async () => {
    const { reversalEntryId } = await recordAndCancel(2, {
      reasonCode: "OTHER",
      reasonText: "  Supplier refunded the card  ",
    });
    expect(await selectReason(reversalEntryId)).toEqual({
      reversalReasonCode: "OTHER",
      reversalReasonText: "Supplier refunded the card",
    });
  });

  it("refuses OTHER without text", async () => {
    const originalEntryId = randomUUID();
    expect((await recordExpense(originalEntryId)).statusCode).toBe(200);
    const response = await post(
      financeToken,
      2,
      { reversalEntryId: randomUUID(), originalEntryId, reasonCode: "OTHER" },
      { expectedVersion: 1 },
    );
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    expect((await selectEntry(originalEntryId))?.status).toBe("POSTED");
  });

  it("still refuses to cancel a cancellation (#130)", async () => {
    const { reversalEntryId } = await recordAndCancel(2, { reasonCode: "ENTERED_TWICE" });
    const response = await post(
      financeToken,
      2,
      { reversalEntryId: randomUUID(), originalEntryId: reversalEntryId, reasonCode: "ENTERED_TWICE" },
      { expectedVersion: 1 },
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "ENTRY_IS_REVERSAL" } });
  });

  it("still accepts v1, read as OTHER with its text", async () => {
    const { reversalEntryId, response } = await recordAndCancel(1, { reason: "Saisie en double" });
    expect(response.statusCode).toBe(200);
    expect(await selectReason(reversalEntryId)).toEqual({
      reversalReasonCode: "OTHER",
      reversalReasonText: "Saisie en double",
    });
  });

  function recordExpense(entryId: string) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands/record-expense",
      headers: { authorization: `Bearer ${driverToken}` },
      payload: {
        version: 1,
        envelope: { commandId: randomUUID(), idempotencyKey: `idem-${randomUUID()}`, origin: "HUMAN_UI" },
        payload: {
          entryId,
          branchCode: "DLA",
          categoryCode: "FUEL",
          economicDate,
          amountMinor: 25_000,
          paymentMethod: "CASH",
          postings: [{ assetId, amountMinor: 25_000 }],
        },
      },
    });
  }

  async function recordAndCancel(version: 1 | 2, reason: Record<string, unknown>) {
    const originalEntryId = randomUUID();
    const recorded = await recordExpense(originalEntryId);
    expect(recorded.json()).toMatchObject({ recordStatus: "POSTED" });
    const reversalEntryId = randomUUID();
    const response = await post(
      financeToken,
      version,
      { reversalEntryId, originalEntryId, ...reason },
      { expectedVersion: 1 },
    );
    expect({ status: response.statusCode, body: response.body }).toMatchObject({ status: 200 });
    return { originalEntryId, reversalEntryId, response };
  }

  function post(
    token: string,
    version: 1 | 2,
    payload: Record<string, unknown>,
    envelope: Record<string, unknown> = {},
  ) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands/reverse-entry",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
          ...envelope,
        },
        payload,
      },
    });
  }

  async function selectEntry(entryId: string) {
    const [entry] = await db
      .select()
      .from(financialEntries)
      .where(and(eq(financialEntries.workspaceId, workspaceId), eq(financialEntries.id, entryId)));
    return entry;
  }

  async function selectReason(entryId: string) {
    const entry = await selectEntry(entryId);
    return {
      reversalReasonCode: entry?.reversalReasonCode ?? null,
      reversalReasonText: entry?.reversalReasonText ?? null,
    };
  }
});
