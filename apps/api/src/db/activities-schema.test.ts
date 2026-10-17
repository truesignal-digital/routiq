import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activities,
  activityAssetSegments,
  commands,
  meterReadings,
  movementLegs,
} from "./schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

/**
 * Structural guarantees the command layer is allowed to rely on. These assert
 * against the database itself, not through handlers — the point is that the
 * invariants survive a bug in, or a bypass of, the handler.
 */
/** Drizzle wraps driver errors, so the SQLSTATE lives on `cause`, not the top level. */
async function pgErrorCode(run: Promise<unknown>): Promise<string | undefined> {
  try {
    await run;
    return undefined;
  } catch (error) {
    const wrapped = error as { code?: string; cause?: { code?: string } };
    return wrapped.cause?.code ?? wrapped.code;
  }
}

describe("activities schema", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  let branchId: string;
  let commandId: string;
  let assetId: string;
  let secondAssetId: string;
  let activityTypeId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    branchId = seeded.branch.id;

    // commands_ws_principal_fk requires the actor to hold a membership.
    const { principal } = await seedMember(ctx.db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });

    commandId = randomUUID();
    await ctx.db.insert(commands).values({
      id: commandId,
      workspaceId,
      commandType: "schema-test",
      origin: "API",
      status: "EXECUTED",
      initiatedByPrincipalId: principal.id,
      idempotencyKey: `idem-${randomUUID()}`,
      payload: {},
    });

    // Assets and the ACTIVITY_TYPE category are inserted through the owner
    // connection: these tests are about constraints, not about handlers.
    const assetRows = await ctx.db.execute(sql`
      insert into assets (id, workspace_id, branch_id, asset_code, asset_class_code,
                          template_code, created_by_command_id)
      values (gen_random_uuid(), ${workspaceId}, ${branchId}, 'SCHEMA-A', 'TRUCK',
              'TRUCKING', ${commandId}),
             (gen_random_uuid(), ${workspaceId}, ${branchId}, 'SCHEMA-B', 'TRUCK',
              'TRUCKING', ${commandId})
      returning id
    `);
    const ids = (assetRows.rows as { id: string }[]).map((row) => row.id);
    assetId = ids[0]!;
    secondAssetId = ids[1]!;

    const typeRows = await ctx.db.execute(sql`
      insert into categories (workspace_id, kind, code, label_fr, label_en)
      values (${workspaceId}, 'ACTIVITY_TYPE', 'SCHEMA_JOB', 'Job', 'Job')
      returning id
    `);
    activityTypeId = (typeRows.rows as { id: string }[])[0]!.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function newActivity(number: string): Promise<string> {
    const id = randomUUID();
    await ctx.db.insert(activities).values({
      id,
      workspaceId,
      branchId,
      activityNumber: number,
      activityTypeId,
      templateCode: "TRUCKING",
      // An OPEN trip always has an actual start (activities_started_at_ck, 0045).
      startedAt: new Date("2026-07-01T06:00:00Z"),
      createdByCommandId: commandId,
    });
    return id;
  }

  function segment(
    activityId: string,
    role: "PRIMARY" | "TRAILER" | "SUBSTITUTE" | "RECOVERY",
    startedAt: string,
    endedAt?: string,
    asset = assetId,
  ) {
    return {
      id: randomUUID(),
      workspaceId,
      activityId,
      assetId: asset,
      role,
      startedAt: new Date(startedAt),
      ...(endedAt === undefined ? {} : { endedAt: new Date(endedAt) }),
      createdByCommandId: commandId,
    };
  }

  describe("carrier overlap exclusion", () => {
    it("rejects a second open carrier while one is still running", async () => {
      const activityId = await newActivity(`OVL-${randomUUID().slice(0, 8)}`);
      await ctx.db
        .insert(activityAssetSegments)
        .values(segment(activityId, "PRIMARY", "2026-07-14T06:10:00Z"));

      // An open segment is an unbounded range, so nothing may start after it.
      expect(await pgErrorCode(ctx.db
          .insert(activityAssetSegments)
          .values(
            segment(activityId, "SUBSTITUTE", "2026-07-14T17:40:00Z", undefined, secondAssetId),
          ))).toBe("23P01");
    });

    it("rejects overlapping closed carrier segments", async () => {
      const activityId = await newActivity(`OVL2-${randomUUID().slice(0, 8)}`);
      await ctx.db
        .insert(activityAssetSegments)
        .values(
          segment(activityId, "PRIMARY", "2026-07-14T06:10:00Z", "2026-07-14T18:00:00Z"),
        );

      expect(await pgErrorCode(ctx.db
          .insert(activityAssetSegments)
          .values(
            segment(
              activityId,
              "SUBSTITUTE",
              "2026-07-14T17:40:00Z",
              "2026-07-14T23:00:00Z",
              secondAssetId,
            ),
          ))).toBe("23P01");
    });

    it("accepts an abutting handover — close at t, open at t", async () => {
      const activityId = await newActivity(`HANDOFF-${randomUUID().slice(0, 8)}`);
      const outgoing = segment(activityId, "PRIMARY", "2026-07-14T06:10:00Z");
      await ctx.db.insert(activityAssetSegments).values(outgoing);

      // Substitution order: close the outgoing segment, then open the incoming
      // one at the same instant. `[)` bounds make these abut, not overlap.
      await ctx.db.execute(sql`
        update activity_asset_segments
        set ended_at = '2026-07-14T17:40:00Z'
        where id = ${outgoing.id}
      `);

      await expect(
        ctx.db.insert(activityAssetSegments).values({
          ...segment(
            activityId,
            "SUBSTITUTE",
            "2026-07-14T17:40:00Z",
            undefined,
            secondAssetId,
          ),
          substitutesSegmentId: outgoing.id,
        }),
      ).resolves.toBeDefined();
    });

    it("allows a trailer to run concurrently with its tractor", async () => {
      const activityId = await newActivity(`TRAILER-${randomUUID().slice(0, 8)}`);
      await ctx.db
        .insert(activityAssetSegments)
        .values(segment(activityId, "PRIMARY", "2026-07-14T06:10:00Z"));

      // TRAILER and RECOVERY are concurrent by design — outside the predicate.
      await expect(
        ctx.db
          .insert(activityAssetSegments)
          .values(
            segment(activityId, "TRAILER", "2026-07-14T06:10:00Z", undefined, secondAssetId),
          ),
      ).resolves.toBeDefined();
    });

    it("scopes the exclusion to one activity — the same window on another job is fine", async () => {
      const first = await newActivity(`SCOPE1-${randomUUID().slice(0, 8)}`);
      const second = await newActivity(`SCOPE2-${randomUUID().slice(0, 8)}`);
      await ctx.db
        .insert(activityAssetSegments)
        .values(segment(first, "PRIMARY", "2026-07-14T06:10:00Z"));

      await expect(
        ctx.db
          .insert(activityAssetSegments)
          .values(segment(second, "PRIMARY", "2026-07-14T06:10:00Z")),
      ).resolves.toBeDefined();
    });
  });

  describe("structural backstops", () => {
    it("requires a place reference or free text on each leg endpoint", async () => {
      const activityId = await newActivity(`LEG-${randomUUID().slice(0, 8)}`);
      expect(
        await pgErrorCode(
          ctx.db.insert(movementLegs).values({
            id: randomUUID(),
            workspaceId,
            activityId,
            legNo: 1,
            destinationText: "Yaoundé",
            createdByCommandId: commandId,
          }),
        ),
      ).toBe("23514");
    });

    it("ties CLOSED to a completeness verdict", async () => {
      const activityId = await newActivity(`CLOSE-${randomUUID().slice(0, 8)}`);
      expect(await pgErrorCode(ctx.db.execute(sql`
          update activities set status = 'CLOSED' where id = ${activityId}
        `))).toBe("23514");
    });

    it("refuses completeness codes on a COMPLETE activity", async () => {
      const activityId = await newActivity(`CODES-${randomUUID().slice(0, 8)}`);
      expect(await pgErrorCode(ctx.db.execute(sql`
          update activities
          set status = 'CLOSED', completeness = 'COMPLETE',
              completeness_codes = ARRAY['ACTIVITY_NO_LEGS']
          where id = ${activityId}
        `))).toBe("23514");
    });

    it("rejects a segment that ends before it starts", async () => {
      const activityId = await newActivity(`IVL-${randomUUID().slice(0, 8)}`);
      expect(await pgErrorCode(ctx.db
          .insert(activityAssetSegments)
          .values(
            segment(activityId, "RECOVERY", "2026-07-14T18:00:00Z", "2026-07-14T06:00:00Z"),
          ))).toBe("23514");
    });
  });

  describe("append-only meter readings", () => {
    it("denies the runtime role everything but the supersede link", async () => {
      const grants = await ctx.db.execute(sql`
        select privilege_type from information_schema.role_table_grants
        where grantee = 'routiq_app' and table_name = 'meter_readings'
      `);
      const privileges = new Set(
        (grants.rows as { privilege_type: string }[]).map((row) => row.privilege_type),
      );
      expect(privileges.has("SELECT")).toBe(true);
      expect(privileges.has("INSERT")).toBe(true);
      expect(privileges.has("UPDATE")).toBe(false);
      expect(privileges.has("DELETE")).toBe(false);

      const columns = await ctx.db.execute(sql`
        select column_name from information_schema.column_privileges
        where grantee = 'routiq_app' and table_name = 'meter_readings'
          and privilege_type = 'UPDATE'
      `);
      expect(
        (columns.rows as { column_name: string }[]).map((row) => row.column_name).sort(),
      ).toEqual(["superseded_by_id", "supersede_reason"].sort());
    });

    it("supersedes at most once per reading", async () => {
      const activityId = await newActivity(`METER-${randomUUID().slice(0, 8)}`);
      const original = randomUUID();
      const first = randomUUID();
      const second = randomUUID();
      await ctx.db.insert(meterReadings).values([
        {
          id: original,
          workspaceId,
          assetId,
          readingType: "ODOMETER",
          value: 412_880n,
          observedAt: new Date("2026-07-14T06:10:00Z"),
          source: "ACTIVITY_START",
          activityId,
          createdByCommandId: commandId,
        },
        {
          id: first,
          workspaceId,
          assetId,
          readingType: "ODOMETER",
          value: 412_890n,
          observedAt: new Date("2026-07-14T06:11:00Z"),
          source: "MANUAL",
          supersededById: original,
          createdByCommandId: commandId,
        },
      ]);

      expect(await pgErrorCode(ctx.db.insert(meterReadings).values({
          id: second,
          workspaceId,
          assetId,
          readingType: "ODOMETER",
          value: 412_895n,
          observedAt: new Date("2026-07-14T06:12:00Z"),
          source: "MANUAL",
          supersededById: original,
          createdByCommandId: commandId,
        }))).toBe("23505");
    });

    it("carries engine hours, not just kilometres", async () => {
      await expect(
        ctx.db.insert(meterReadings).values({
          id: randomUUID(),
          workspaceId,
          assetId,
          readingType: "HOURS",
          value: 4_812n,
          observedAt: new Date("2026-07-08T08:00:00Z"),
          source: "ACTIVITY_START",
          createdByCommandId: commandId,
        }),
      ).resolves.toBeDefined();
    });
  });
});
