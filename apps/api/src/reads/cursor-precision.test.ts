import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvents } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

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
  let truck: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    admin = await seedActor(ctx.db, { workspaceId: seeded.workspace.id, role: "ADMIN" });
    truck = await seedAsset(ctx.app, admin.token);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function walk<T>(firstPage: string, id: (item: T) => string): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = cursor ? `${firstPage}&cursor=${cursor}` : firstPage;
      const page = await api.get(admin.token, url);
      expect(page.status, JSON.stringify(page.body)).toBe(200);
      const body = page.body as Page<T>;
      seen.push(...body.items.map(id));
      cursor = body.nextCursor;
    } while (cursor);
    return seen;
  }

  const forged = (value: unknown, field = "createdAt") =>
    Buffer.from(JSON.stringify({ field, direction: "desc", value, id: randomUUID() })).toString(
      "base64url",
    );

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

  it("refuses a boundary that is not a timestamp with 400, on every timestamp list", async () => {
    const routes = [
      [`/v1/assets/${truck}/history`, "occurredAt"],
      ["/v1/work-orders", "createdAt"],
      ["/v1/issues", "reportedAt"],
      [`/v1/history/asset/${truck}`, "occurredAt"],
    ] as const;
    for (const [route, field] of routes) {
      for (const value of ["not-a-time", "2026-02-30T00:00:00Z", 1_788_256_800_000]) {
        const response = await api.get(admin.token, `${route}?cursor=${forged(value, field)}`);
        expect(response.status, `${route} ${String(value)}`).toBe(400);
        expect(response.body).toEqual({ error: { code: "VALIDATION_FAILED" } });
      }
    }
  });
});
