import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvents, meterReadings } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

type Page<T> = { nextCursor: string | null } & Partial<Record<"items" | "entries", T[]>>;

/**
 * Keyset cursors over timestamps Postgres stamps itself carry microseconds; a
 * millisecond boundary skipped every row sharing its millisecond (review P6,
 * and the same risk on /v1/history). A tampered boundary is a 400, never a
 * value handed to Postgres to fail as a 500 (review P5).
 */
describe("timestamp keyset cursors", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let admin: Actor;
  let submitter: Actor;
  let truck: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    admin = await seedActor(ctx.db, { workspaceId: seeded.workspace.id, role: "ADMIN" });
    submitter = await seedActor(ctx.db, {
      workspaceId: seeded.workspace.id,
      role: "FIELD_SUBMITTER",
    });
    truck = await seedAsset(ctx.app, admin.token);
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** Every page of a list, bounded: a millisecond boundary on an ascending sort repeats rows. */
  async function walk<T>(
    firstPage: string,
    id: (item: T) => string,
    key: "items" | "entries" = "items",
  ): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = cursor ? `${firstPage}&cursor=${cursor}` : firstPage;
      const page = await api.get(admin.token, url);
      expect(page.status, JSON.stringify(page.body)).toBe(200);
      const body = page.body as Page<T>;
      seen.push(...(body[key] ?? []).map(id));
      cursor = body.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    return seen;
  }

  const forged = (value: unknown, field = "createdAt", direction: "asc" | "desc" = "desc") =>
    Buffer.from(JSON.stringify({ field, direction, value, id: randomUUID() })).toString(
      "base64url",
    );

  /**
   * Stamps three rows inside one millisecond. The ledger's immutability
   * triggers guard these columns, so the owner lifts them for this update only.
   */
  async function restamp(table: string, column: string, ids: string[], stamps: string[]) {
    await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      for (const [index, id] of ids.entries()) {
        await tx.execute(
          sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = ${stamps[index]}::timestamptz
              where id = ${id}`,
        );
      }
    });
  }

  /** Newest first: the first id carries the latest stamp. */
  const descending = [
    "2026-09-01 10:00:00.123300+00",
    "2026-09-01 10:00:00.123200+00",
    "2026-09-01 10:00:00.123100+00",
  ];

  async function expense(actor: Actor, assetId: string, amountMinor: number): Promise<string> {
    const entryId = randomUUID();
    await api.ok(actor.token, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-08-12",
      amountMinor,
      paymentMethod: "CASH",
      postings: [{ assetId, amountMinor }],
    });
    return entryId;
  }

  it("walks every work order when two receipts share a millisecond", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const created = await api.ok(admin.token, "create-work-order", {
        workOrderId: randomUUID(),
        assetId: truck,
        description: `Ordre ${i}`,
        expectedCostMinor: 0,
      });
      ids.push(created.recordId);
    }
    const stamps = [
      "2026-09-01 10:00:00.123400+00",
      "2026-09-01 10:00:00.123300+00",
      "2026-09-01 09:59:59.000000+00",
    ];
    for (const [index, id] of ids.entries()) {
      await ctx.db.execute(
        sql`update commands set executed_at = ${stamps[index]}::timestamptz
            where id = (select created_by_command_id from work_orders where id = ${id})`,
      );
    }

    const seen = await walk<{ id: string }>(`/v1/work-orders?assetId=${truck}&limit=1`, (item) => item.id);
    expect(seen).toEqual(ids);
  });

  it("walks every event of a record when two share a millisecond", async () => {
    const workOrderId = randomUUID();
    const created = await api.ok(admin.token, "create-work-order", {
      workOrderId,
      assetId: truck,
      description: "Vidange",
      expectedCostMinor: 0,
    });
    await api.ok(
      admin.token,
      "complete-work-order",
      { workOrderId, actualCostMinor: 0 },
      { expectedVersion: created.rowVersion },
    );
    const events = await ctx.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, workOrderId))
      .orderBy(auditEvents.occurredAt);
    expect(events).toHaveLength(2);
    const stamps = ["2026-09-01 10:00:00.123300+00", "2026-09-01 10:00:00.123400+00"];
    for (const [index, event] of events.entries()) {
      await ctx.db.execute(
        sql`update audit_events set occurred_at = ${stamps[index]}::timestamptz where id = ${event.id}`,
      );
    }

    const seen = await walk<{ eventId: string }>(
      `/v1/history/work_order/${workOrderId}?limit=1`,
      (item) => item.eventId,
    );
    expect(seen).toEqual(events.map((event) => event.id).reverse());
  });

  it("walks the approvals queue when three submissions share a millisecond", async () => {
    const queueTruck = await seedAsset(ctx.app, admin.token);
    const ids: string[] = [];
    // Above the auto-approval threshold, so each stays SUBMITTED.
    for (let i = 0; i < 3; i++) ids.push(await expense(submitter, queueTruck, 150_000));
    await restamp("financial_entries", "created_at", ids, [...descending].reverse());

    const seen = await walk<{ id: string }>(
      "/v1/finance/approvals?limit=1",
      (item) => item.id,
      "entries",
    );
    expect(seen).toEqual(ids);
  });

  it("walks the ledger when three entries posted in one millisecond", async () => {
    const ledgerTruck = await seedAsset(ctx.app, admin.token);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await expense(admin, ledgerTruck, 30_000));
    await restamp("financial_entries", "posted_at", ids, descending);

    const seen = await walk<{ id: string }>(
      `/v1/finance/entries?assetId=${ledgerTruck}&limit=1`,
      (item) => item.id,
      "entries",
    );
    expect(seen).toEqual(ids);
  });

  it("walks the activities when three started in one millisecond", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const created = await api.ok(admin.token, "create-activity", {
        activityId: randomUUID(),
        branchCode: "DLA",
        activityTypeCode: "HAULAGE_JOB",
        templateCode: "TRUCKING",
        primarySegmentId: randomUUID(),
        primaryAssetId: await seedAsset(ctx.app, admin.token),
        startedAt: "2026-07-10T06:00:00Z",
      });
      ids.push(created.recordId);
    }
    await restamp("activities", "started_at", ids, descending);

    const seen = await walk<{ id: string }>("/v1/activities?limit=1", (item) => item.id);
    expect(seen).toEqual(ids);
  });

  it("walks a vehicle's readings when three were observed in one millisecond", async () => {
    const readingTruck = await seedAsset(ctx.app, admin.token);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const readingId = randomUUID();
      await api.ok(admin.token, "record-meter-reading", {
        readingId,
        assetId: readingTruck,
        readingType: "ODOMETER",
        value: 120_000 + i,
        observedAt: `2026-07-12T0${8 - i}:00:00Z`,
      });
      ids.push(readingId);
    }
    await restamp("meter_readings", "observed_at", ids, descending);
    const readings = await ctx.db
      .select({ id: meterReadings.id })
      .from(meterReadings)
      .where(eq(meterReadings.assetId, readingTruck));
    expect(readings).toHaveLength(3);

    const seen = await walk<{ id: string }>(
      `/v1/assets/${readingTruck}/readings?limit=1`,
      (item) => item.id,
    );
    expect(seen).toEqual(ids);
  });

  it("refuses a boundary that is not a timestamp with 400, on every timestamp list", async () => {
    const routes = [
      [`/v1/assets/${truck}/history`, "occurredAt", "desc"],
      ["/v1/work-orders", "createdAt", "desc"],
      ["/v1/issues", "reportedAt", "desc"],
      [`/v1/history/asset/${truck}`, "occurredAt", "desc"],
      ["/v1/finance/approvals", "submittedAt", "asc"],
      ["/v1/finance/entries", "postedAt", "desc"],
      ["/v1/activities", "startedAt", "desc"],
      [`/v1/assets/${truck}/readings`, "observedAt", "desc"],
    ] as const;
    for (const [route, field, direction] of routes) {
      // A well-formed boundary under the same sort is served: the 400s below
      // are the value's, not a sort mismatch's.
      const served = await api.get(
        admin.token,
        `${route}?cursor=${forged("2026-09-01T10:00:00.123400Z", field, direction)}`,
      );
      expect(served.status, `${route} well-formed`).toBe(200);

      for (const value of ["not-a-time", "2026-02-30T00:00:00Z", 1_788_256_800_000]) {
        const response = await api.get(
          admin.token,
          `${route}?cursor=${forged(value, field, direction)}`,
        );
        expect(response.status, `${route} ${String(value)}`).toBe(400);
        expect(response.body).toEqual({ error: { code: "VALIDATION_FAILED" } });
      }
    }
  });

  it("refuses a date or amount boundary its column cannot hold with 400", async () => {
    const cases = [
      ["/v1/finance/entries", "economicDate", "desc", ["not-a-date", "2026-02-30", 20_260_812]],
      ["/v1/finance/entries", "amount", "asc", ["12abc", "99999999999999999999", 30_000]],
      ["/v1/finance/approvals", "amount", "desc", ["12abc", "1.5"]],
    ] as const;
    for (const [route, field, direction, values] of cases) {
      for (const value of values) {
        const response = await api.get(
          admin.token,
          `${route}?sort=${field}:${direction}&cursor=${forged(value, field, direction)}`,
        );
        expect(response.status, `${route} ${field} ${String(value)}`).toBe(400);
        expect(response.body).toEqual({ error: { code: "VALIDATION_FAILED" } });
      }
    }
  });
});
