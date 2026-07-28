import { randomUUID } from "node:crypto";
import { recordHaulageJobSheetCommand, recordJourneySheetCommand } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activities,
  activityAssetSegments,
  activityPeople,
  financialEntries,
  financialPostings,
  meterReadings,
  movementLegs,
  postingPeriods,
} from "../db/schema.js";
import { createSession } from "../auth/local.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

/**
 * The Douala -> Ngaoundéré load: one submission, fifteen rows, one transaction.
 * §5.1 calls the composite sheets the pilot's make-or-break.
 */
describe("record-haulage-job-sheet.v1 / record-journey-sheet.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  let token: string;
  let tractorId: string;
  let trailerId: string;
  let driverId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    const member = await seedMember(ctx.db, {
      workspaceId,
      role: "FIELD_SUBMITTER",
      allBranches: true,
    });
    token = (await createSession(ctx.db, { workspaceId, principalId: member.principal.id }))
      .token;

    const manager = await seedMember(ctx.db, {
      workspaceId,
      role: "OPS_MANAGER",
      allBranches: true,
    });
    const managerToken = (
      await createSession(ctx.db, { workspaceId, principalId: manager.principal.id })
    ).token;

    tractorId = await seedAsset(ctx.app, managerToken, { assetCode: "CMR-TR-014" });
    trailerId = await seedAsset(ctx.app, managerToken, { assetCode: "CMR-RM-007" });

    driverId = randomUUID();
    const person = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/register-person",
      headers: { authorization: `Bearer ${managerToken}` },
      payload: {
        name: "register-person",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
          sourceArtifactIds: [],
        },
        payload: {
          personId: driverId,
          displayName: "Abdoulaye Sanda",
          branchCode: "DLA",
          defaultRole: "DRIVER",
        },
      },
    });
    expect(person.statusCode).toBe(200);
  });

  afterAll(async () => {
    await ctx.close();
  });

  function haulageSheet(overrides: Record<string, unknown> = {}) {
    const activityId = randomUUID();
    return {
      activityId,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      primarySegmentId: randomUUID(),
      primaryAssetId: tractorId,
      startedAt: "2026-07-14T06:10:00Z",
      endedAt: "2026-07-15T09:00:00Z",
      customerName: "Brasseries du Cameroun",
      clientReference: "WB-4471",
      cargoDescription: "28 t boissons palettisées",
      cargoWeightKg: 28_000,
      startReading: {
        readingId: randomUUID(),
        readingType: "ODOMETER" as const,
        value: 412_880,
        observedAt: "2026-07-14T06:10:00Z",
      },
      endReading: {
        readingId: randomUUID(),
        readingType: "ODOMETER" as const,
        value: 414_005,
        observedAt: "2026-07-15T09:00:00Z",
      },
      crew: [{ activityPersonId: randomUUID(), personId: driverId, role: "DRIVER" as const }],
      extraSegments: [
        {
          segmentId: randomUUID(),
          assetId: trailerId,
          role: "TRAILER" as const,
          startedAt: "2026-07-14T06:10:00Z",
        },
      ],
      legs: [
        {
          legId: randomUUID(),
          legNo: 1,
          origin: { kind: "place" as const, placeId: randomUUID(), name: "Douala" },
          destination: { kind: "place" as const, placeId: randomUUID(), name: "Yaoundé" },
          distanceKm: 245,
          loadState: "LADEN" as const,
        },
        {
          legId: randomUUID(),
          legNo: 2,
          origin: { kind: "place" as const, placeId: randomUUID(), name: "Yaoundé" },
          destination: { kind: "place" as const, placeId: randomUUID(), name: "Ngaoundéré" },
          distanceKm: 880,
          loadState: "LADEN" as const,
        },
      ],
      entries: [
        {
          entryId: randomUUID(),
          direction: "REVENUE" as const,
          categoryCode: "FREIGHT_REVENUE",
          amountMinor: 1_850_000,
          economicDate: "2026-07-15",
          paymentMethod: "BANK" as const,
          paymentReference: "VIR-88213",
        },
        {
          // Above the 100 000 XAF pilot threshold for a FIELD_SUBMITTER.
          entryId: randomUUID(),
          direction: "EXPENSE" as const,
          categoryCode: "FUEL",
          amountMinor: 320_000,
          economicDate: "2026-07-14",
          assetId: tractorId,
        },
        {
          entryId: randomUUID(),
          direction: "EXPENSE" as const,
          categoryCode: "TOLLS",
          amountMinor: 15_000,
          economicDate: "2026-07-14",
        },
        {
          entryId: randomUUID(),
          direction: "EXPENSE" as const,
          categoryCode: "DRIVER_ALLOWANCE",
          amountMinor: 60_000,
          economicDate: "2026-07-15",
          personId: driverId,
        },
        {
          // §3.4 inv. 7: the clutch repair belongs to the truck, not the haul.
          entryId: randomUUID(),
          direction: "EXPENSE" as const,
          categoryCode: "REPAIRS",
          amountMinor: 185_000,
          economicDate: "2026-07-14",
          assetId: tractorId,
          attributeToActivity: false,
        },
      ],
      ...overrides,
    };
  }

  function postHaulage(payload: Record<string, unknown>, idempotencyKey?: string) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands/record-haulage-job-sheet",
      headers: { authorization: `Bearer ${token}` },
      payload: recordHaulageJobSheetCommand.parse({
        name: "record-haulage-job-sheet",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: idempotencyKey ?? `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload,
      }),
    });
  }

  it("writes the whole waybill in one commit", async () => {
    const sheet = haulageSheet();
    const response = await postHaulage(sheet);
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body).toMatchObject({
      recordId: sheet.activityId,
      recordStatus: "COMPLETE",
    });

    const [activity] = await ctx.db
      .select()
      .from(activities)
      .where(eq(activities.id, sheet.activityId));
    expect(activity).toMatchObject({
      status: "CLOSED",
      completeness: "COMPLETE",
      customerName: "Brasseries du Cameroun",
      clientReference: "WB-4471",
    });
    // Flavour fields ride in custom_values, not in new columns (§3.3).
    expect(activity?.customValues).toMatchObject({
      cargoDescription: "28 t boissons palettisées",
      cargoWeightKg: 28_000,
    });

    const segments = await ctx.db
      .select()
      .from(activityAssetSegments)
      .where(eq(activityAssetSegments.activityId, sheet.activityId));
    expect(segments).toHaveLength(2);
    expect(segments.map((s) => s.role).sort()).toEqual(["PRIMARY", "TRAILER"]);

    const legs = await ctx.db
      .select()
      .from(movementLegs)
      .where(eq(movementLegs.activityId, sheet.activityId));
    expect(legs).toHaveLength(2);

    const crew = await ctx.db
      .select()
      .from(activityPeople)
      .where(eq(activityPeople.activityId, sheet.activityId));
    expect(crew).toHaveLength(1);

    const readings = await ctx.db
      .select()
      .from(meterReadings)
      .where(eq(meterReadings.activityId, sheet.activityId));
    expect(readings).toHaveLength(2);
    expect(readings.map((r) => r.source).sort()).toEqual(["ACTIVITY_END", "ACTIVITY_START"]);
  });

  it("holds the above-threshold fuel line while the rest of the sheet commits", async () => {
    const sheet = haulageSheet();
    const body = (await postHaulage(sheet)).json();

    expect(body.children).toHaveLength(5);
    const byId = new Map(
      (body.children as { id: string; status: string }[]).map((child) => [
        child.id,
        child.status,
      ]),
    );
    const [revenue, fuel, tolls, allowance, repair] = sheet.entries;

    // The threshold fires per embedded line, inside the sheet rather than around
    // it: a field clerk auto-posts through 100 000 XAF and no further, so the
    // freight invoice, the fuel and the repair all wait while the small lines
    // land. Exactly what a standalone entry would do at the same amounts.
    expect(byId.get(revenue!.entryId)).toBe("SUBMITTED");
    expect(byId.get(fuel!.entryId)).toBe("SUBMITTED");
    expect(byId.get(repair!.entryId)).toBe("SUBMITTED");
    expect(byId.get(tolls!.entryId)).toBe("POSTED");
    expect(byId.get(allowance!.entryId)).toBe("POSTED");

    // ...and the trip itself is recorded regardless.
    const [activity] = await ctx.db
      .select()
      .from(activities)
      .where(eq(activities.id, sheet.activityId));
    expect(activity?.status).toBe("CLOSED");
  });

  it("attributes every cost to the job except the repair to the failed truck", async () => {
    const sheet = haulageSheet();
    await postHaulage(sheet);

    const postings = await ctx.db
      .select({
        entryId: financialPostings.financialEntryId,
        activityId: financialPostings.activityId,
        assetId: financialPostings.assetId,
        personId: financialPostings.personId,
        amountMinor: financialPostings.amountMinor,
      })
      .from(financialPostings)
      .where(eq(financialPostings.workspaceId, workspaceId));

    const [revenue, fuel, , allowance, repair] = sheet.entries;
    const find = (entryId: string) => postings.find((p) => p.entryId === entryId);

    expect(find(revenue!.entryId)?.activityId).toBe(sheet.activityId);
    expect(find(fuel!.entryId)).toMatchObject({
      activityId: sheet.activityId,
      assetId: tractorId,
    });
    // Crew pay carries the person — this is what makes §9 report 8 a query.
    expect(find(allowance!.entryId)?.personId).toBe(driverId);
    // The repair carries the asset and NOT the activity.
    expect(find(repair!.entryId)).toMatchObject({
      activityId: null,
      assetId: tractorId,
    });
  });

  it("replays an identical retry without writing a second trip", async () => {
    const sheet = haulageSheet();
    const key = `idem-${randomUUID()}`;
    const first = await postHaulage(sheet, key);
    expect(first.statusCode).toBe(200);

    const replay = await postHaulage(sheet, key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ idempotentReplay: true });
    // children must survive the receipt round trip, or replay 500s.
    expect(replay.json().children).toHaveLength(5);

    const rows = await ctx.db
      .select()
      .from(activities)
      .where(eq(activities.id, sheet.activityId));
    expect(rows).toHaveLength(1);
    const legs = await ctx.db
      .select()
      .from(movementLegs)
      .where(eq(movementLegs.activityId, sheet.activityId));
    expect(legs).toHaveLength(2);
  });

  it("leaves nothing behind when the last insert fails", async () => {
    const sheet = haulageSheet({
      entries: [
        {
          entryId: randomUUID(),
          direction: "REVENUE",
          categoryCode: "NOT_A_CATEGORY",
          amountMinor: 1_000,
          economicDate: "2026-07-15",
        },
      ],
    });
    const response = await postHaulage(sheet);
    expect(response.statusCode).toBe(422);

    const id = sheet.activityId as string;
    // Nothing survives a failed sheet — not the trip, not its legs, not the
    // readings that were written before the entry that blew up.
    expect(
      await ctx.db.select().from(activities).where(eq(activities.id, id)),
    ).toHaveLength(0);
    expect(
      await ctx.db
        .select()
        .from(activityAssetSegments)
        .where(eq(activityAssetSegments.activityId, id)),
    ).toHaveLength(0);
    expect(
      await ctx.db.select().from(movementLegs).where(eq(movementLegs.activityId, id)),
    ).toHaveLength(0);
    expect(
      await ctx.db.select().from(activityPeople).where(eq(activityPeople.activityId, id)),
    ).toHaveLength(0);
    expect(
      await ctx.db.select().from(meterReadings).where(eq(meterReadings.activityId, id)),
    ).toHaveLength(0);
  });

  it("records a completed trip against a locked period instead of destroying it", async () => {
    // Lock through the real command, not a hand-written row. Both the economic
    // month and the current month must be locked: resolvePostingPeriod
    // late-posts to the live month when the economic one is shut, and only
    // throws PERIOD_LOCKED when that escape is closed too.
    const finance = await seedMember(ctx.db, {
      workspaceId,
      role: "FINANCE_APPROVER",
      allBranches: true,
    });
    const financeToken = (
      await createSession(ctx.db, { workspaceId, principalId: finance.principal.id })
    ).token;
    const lock = (periodCode: string) =>
      ctx.app.inject({
        method: "POST",
        url: "/v1/commands/lock-period",
        headers: { authorization: `Bearer ${financeToken}` },
        payload: {
          name: "lock-period",
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey: `idem-${randomUUID()}`,
            origin: "HUMAN_UI",
            expectedVersion: 1,
            sourceArtifactIds: [],
          },
          payload: { periodCode },
        },
      });

    const currentPeriod = new Date().toISOString().slice(0, 7);
    expect((await lock("2026-03")).statusCode).toBe(200);
    expect((await lock(currentPeriod)).statusCode).toBe(200);

    const sheet = haulageSheet({
      startedAt: "2026-03-02T06:00:00Z",
      endedAt: "2026-03-03T09:00:00Z",
      extraSegments: [
        {
          segmentId: randomUUID(),
          assetId: trailerId,
          role: "TRAILER" as const,
          startedAt: "2026-03-02T06:00:00Z",
        },
      ],
      entries: [
        {
          entryId: randomUUID(),
          direction: "REVENUE",
          categoryCode: "FREIGHT_REVENUE",
          amountMinor: 50_000,
          economicDate: "2026-03-02",
          paymentMethod: "CASH",
        },
      ],
    });
    const response = await postHaulage(sheet);

    // The trip is a physical fact; a locked ledger must not erase it.
    expect(response.statusCode).toBe(200);
    expect(response.json().warnings).toContain("POSTING_DEFERRED_PERIOD_LOCKED");
    const [entry] = await ctx.db
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.id, sheet.entries[0]!.entryId));
    expect(entry).toMatchObject({ status: "SUBMITTED", postingPeriodId: null });

    const [activity] = await ctx.db
      .select()
      .from(activities)
      .where(eq(activities.id, sheet.activityId));
    expect(activity?.status).toBe("CLOSED");

    await ctx.db
      .update(postingPeriods)
      .set({ status: "OPEN" })
      .where(eq(postingPeriods.workspaceId, workspaceId));
  });

  it("names a mistyped coupling time instead of failing the command", async () => {
    // An extra segment with no end inherits the sheet's. A trailer coupled after
    // the trip ended is a clerk's slip, and used to surface as COMMAND_FAILED.
    const sheet = haulageSheet({
      extraSegments: [
        {
          segmentId: randomUUID(),
          assetId: trailerId,
          role: "TRAILER" as const,
          startedAt: "2026-07-20T06:00:00Z",
        },
      ],
    });
    const response = await postHaulage(sheet);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        metadata: { reason: "segment ends before it starts" },
      },
    });
  });

  it("records a passenger journey through the same writer", async () => {
    const activityId = randomUUID();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/record-journey-sheet",
      headers: { authorization: `Bearer ${token}` },
      payload: recordJourneySheetCommand.parse({
        name: "record-journey-sheet",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: {
          activityId,
          branchCode: "DLA",
          activityTypeCode: "SCHEDULED_JOURNEY",
          primarySegmentId: randomUUID(),
          primaryAssetId: tractorId,
          startedAt: "2026-07-16T06:00:00Z",
          endedAt: "2026-07-16T11:00:00Z",
          seatsSold: 68,
          seatsAvailable: 70,
          crew: [
            { activityPersonId: randomUUID(), personId: driverId, role: "DRIVER" },
          ],
          legs: [
            {
              legId: randomUUID(),
              legNo: 1,
              origin: { kind: "place", placeId: randomUUID(), name: "Yaoundé" },
              destination: { kind: "place", placeId: randomUUID(), name: "Bafoussam" },
              distanceKm: 291,
              passengerCount: 68,
            },
          ],
          startReading: {
            readingId: randomUUID(),
            readingType: "ODOMETER",
            value: 500_000,
            observedAt: "2026-07-16T06:00:00Z",
          },
          endReading: {
            readingId: randomUUID(),
            readingType: "ODOMETER",
            value: 500_291,
            observedAt: "2026-07-16T11:00:00Z",
          },
          entries: [
            {
              entryId: randomUUID(),
              direction: "REVENUE",
              categoryCode: "TICKET_REVENUE",
              amountMinor: 952_000,
              economicDate: "2026-07-16",
              paymentMethod: "CASH",
              paymentReference: "CS-2026-0714",
            },
          ],
        },
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ recordStatus: "COMPLETE" });

    const [activity] = await ctx.db
      .select()
      .from(activities)
      .where(eq(activities.id, activityId));
    // Same tables, different paper.
    expect(activity).toMatchObject({ templateCode: "PASSENGER_TRANSPORT", status: "CLOSED" });
    expect(activity?.customValues).toMatchObject({ seatsSold: 68, seatsAvailable: 70 });
  });
});
