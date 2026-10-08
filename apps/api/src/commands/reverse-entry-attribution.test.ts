import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { financialEntries, financialPostings } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";
import { currentPeriodCode } from "./periods.js";

/**
 * A reversal subtracts wherever the original counted (§4.2, #60): the truck,
 * the trip, the person and the repair. A line that loses one of them leaves a
 * reversed cost standing in that dimension's totals.
 */
describe("reverse-entry.v1 keeps every attribution", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let adminToken: string;
  let approverToken: string;
  let assetId: string;
  let activityId: string;
  let personId: string;
  let workOrderId: string;
  const economicDate = `${currentPeriodCode(new Date(), "Africa/Douala")}-15`;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;

    const session = async (role: "ADMIN" | "FINANCE") => {
      const member = await seedMember(db, { workspaceId, role, allBranches: true });
      return (await createSession(db, { workspaceId, principalId: member.principal.id }))
        .token;
    };
    adminToken = await session("ADMIN");
    approverToken = await session("FINANCE");

    assetId = await seedAsset(ctx.app, adminToken);

    activityId = randomUUID();
    expectOk(
      await post(adminToken, "create-activity", {
        activityId,
        branchCode: "DLA",
        activityTypeCode: "HAULAGE_JOB",
        templateCode: "TRUCKING",
        primarySegmentId: randomUUID(),
        primaryAssetId: assetId,
        startedAt: `${economicDate}T06:00:00Z`,
      }),
    );

    personId = randomUUID();
    expectOk(
      await post(adminToken, "register-person", {
        personId,
        displayName: "Abdoulaye Sanda",
        branchCode: "DLA",
        defaultRole: "DRIVER",
      }),
    );

    workOrderId = randomUUID();
    expectOk(
      await post(adminToken, "create-work-order", {
        workOrderId,
        assetId,
        description: "Remplacement des plaquettes de frein",
        expectedCostMinor: 60_000,
      }),
    );
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("copies the trip and work order of a recorded expense, and the trip nets to zero", async () => {
    const entryId = randomUUID();
    const recorded = await post(adminToken, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "REPAIRS",
      economicDate,
      amountMinor: 45_000,
      paymentMethod: "CASH",
      postings: [{ assetId, activityId, workOrderId, amountMinor: 45_000 }],
    });
    expectOk(recorded);
    expect(recorded.json()).toMatchObject({ recordStatus: "POSTED" });

    const reversalEntryId = await reverse(entryId);

    const [reversalLine] = await postingsOf(reversalEntryId);
    expect(reversalLine).toMatchObject({
      assetId,
      activityId,
      workOrderId,
      amountMinor: -45_000n,
    });

    const detail = await ctx.app.inject({
      method: "GET",
      url: `/v1/activities/${activityId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(detail.statusCode).toBe(200);
    const shown = (
      detail.json() as { financialEntries: Array<{ entryId: string; amountMinor: number }> }
    ).financialEntries.filter((entry) =>
      [entryId, reversalEntryId].includes(entry.entryId),
    );
    expect(shown.map((entry) => entry.entryId).sort()).toEqual(
      [entryId, reversalEntryId].sort(),
    );
    expect(shown.reduce((sum, entry) => sum + entry.amountMinor, 0)).toBe(0);
  });

  it("copies every attribution column of every line, including the person", async () => {
    // No v1 command writes a line with a person and a work order together, or
    // an ALLOCATED trip share; a future writer may. Clone a posted entry with
    // lines that carry all of them, so the reversal is tested on every column.
    const templateId = randomUUID();
    expectOk(
      await post(adminToken, "record-expense", {
        entryId: templateId,
        branchCode: "DLA",
        categoryCode: "REPAIRS",
        economicDate,
        amountMinor: 1_000,
        paymentMethod: "CASH",
        postings: [{ assetId, amountMinor: 1_000 }],
      }),
    );
    const [template] = await db
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.id, templateId));
    const [templateLine] = await postingsOf(templateId);
    if (!template || !templateLine) throw new Error("template entry missing");

    const entryId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(financialEntries).values({
        ...template,
        id: entryId,
        entryNumber: `ATTR-${entryId.slice(0, 8)}`,
        amountMinor: 310_000n,
        rowVersion: 1,
      });
      await tx.insert(financialPostings).values([
        {
          ...templateLine,
          id: randomUUID(),
          financialEntryId: entryId,
          lineNo: 1,
          assetId,
          activityId,
          personId,
          workOrderId,
          amountMinor: 250_000n,
          assetAttribution: "DIRECT",
          activityAttribution: "DIRECT",
        },
        {
          ...templateLine,
          id: randomUUID(),
          financialEntryId: entryId,
          lineNo: 2,
          assetId,
          activityId,
          personId,
          workOrderId: null,
          amountMinor: 60_000n,
          assetAttribution: "ALLOCATED",
          activityAttribution: "ALLOCATED",
        },
      ]);
    });

    const reversalEntryId = await reverse(entryId);

    const originalLines = await postingsOf(entryId);
    const reversalLines = await postingsOf(reversalEntryId);
    expect(reversalLines).toHaveLength(originalLines.length);
    // Every column not listed here is copied. A new attribution column on the
    // posting line fails this test until the reversal copies it too.
    const ownedByTheReversal = new Set([
      "id",
      "financialEntryId",
      "postingPeriodId",
      "amountMinor",
      "createdByCommandId",
      "createdAt",
    ]);
    originalLines.forEach((original, index) => {
      const reversal = reversalLines[index]!;
      for (const [column, value] of Object.entries(original)) {
        if (ownedByTheReversal.has(column)) continue;
        expect({ column, value: reversal[column as keyof typeof reversal] }).toEqual({
          column,
          value,
        });
      }
      expect(reversal.amountMinor).toBe(-original.amountMinor);
    });

    // Truck, trip, person and repair totals all net to zero.
    const both = [entryId, reversalEntryId];
    for (const [dimension, column, id] of [
      ["asset", financialPostings.assetId, assetId],
      ["activity", financialPostings.activityId, activityId],
      ["person", financialPostings.personId, personId],
      ["workOrder", financialPostings.workOrderId, workOrderId],
    ] as const) {
      const [row] = await db
        .select({ total: sql<string>`coalesce(sum(${financialPostings.amountMinor}), 0)` })
        .from(financialPostings)
        .where(
          and(
            eq(financialPostings.workspaceId, workspaceId),
            inArray(financialPostings.financialEntryId, both),
            eq(column, id),
          ),
        );
      expect({ dimension, total: BigInt(row?.total ?? "-1") }).toEqual({
        dimension,
        total: 0n,
      });
    }
  });

  async function reverse(originalEntryId: string): Promise<string> {
    const reversalEntryId = randomUUID();
    const response = await post(
      approverToken,
      "reverse-entry",
      { reversalEntryId, originalEntryId, reason: "Facture en double" },
      { expectedVersion: 1 },
    );
    expectOk(response);
    return reversalEntryId;
  }

  function postingsOf(entryId: string) {
    return db
      .select()
      .from(financialPostings)
      .where(
        and(
          eq(financialPostings.workspaceId, workspaceId),
          eq(financialPostings.financialEntryId, entryId),
        ),
      )
      .orderBy(asc(financialPostings.lineNo));
  }

  function post(
    token: string,
    name: string,
    payload: Record<string, unknown>,
    envelope: Record<string, unknown> = {},
  ) {
    return ctx.app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name,
        version: 1,
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
});

function expectOk(response: { statusCode: number; body: string }) {
  expect({ status: response.statusCode, body: response.body }).toMatchObject({ status: 200 });
}
