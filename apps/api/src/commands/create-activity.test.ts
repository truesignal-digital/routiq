import { randomUUID } from "node:crypto";
import {
  createActivityCommand,
  createActivityPayload,
  registerPersonCommand,
} from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activities,
  activityAssetSegments,
  activityPeople,
  assets,
  meterReadings,
} from "../db/schema.js";
import { createSession } from "../auth/local.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

describe("create-activity.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  let clerkToken: string;
  let managerToken: string;
  let truckId: string;
  let driverId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;

    const clerk = await seedMember(ctx.db, {
      workspaceId,
      role: "FIELD_SUBMITTER",
      allBranches: true,
    });
    clerkToken = (
      await createSession(ctx.db, { workspaceId, principalId: clerk.principal.id })
    ).token;

    const manager = await seedMember(ctx.db, {
      workspaceId,
      role: "OPS_MANAGER",
      allBranches: true,
    });
    managerToken = (
      await createSession(ctx.db, { workspaceId, principalId: manager.principal.id })
    ).token;

    truckId = await seedAsset(ctx.app, managerToken, { assetCode: "CMR-TR-014" });

    driverId = randomUUID();
    const person = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/register-person",
      headers: { authorization: `Bearer ${managerToken}` },
      payload: registerPersonCommand.parse({
        name: "register-person",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: {
          personId: driverId,
          displayName: "Abdoulaye Sanda",
          branchCode: "DLA",
          defaultRole: "DRIVER",
        },
      }),
    });
    expect(person.statusCode).toBe(200);
  });

  afterAll(async () => {
    await ctx.close();
  });

  type ActivityPayload = z.input<typeof createActivityPayload>;

  function build(overrides: Partial<ActivityPayload> = {}): ActivityPayload {
    return {
      activityId: randomUUID(),
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      primarySegmentId: randomUUID(),
      primaryAssetId: truckId,
      startedAt: "2026-07-14T06:10:00Z",
      customerName: "Brasseries du Cameroun",
      clientReference: "WB-4471",
      ...overrides,
    };
  }

  async function post(
    payload: ActivityPayload,
    opts: { token?: string; idempotencyKey?: string } = {},
  ) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands/create-activity",
      headers: { authorization: `Bearer ${opts.token ?? clerkToken}` },
      payload: createActivityCommand.parse({
        name: "create-activity",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: opts.idempotencyKey ?? `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload,
      }),
    });
  }

  it("opens an activity with its carrier segment, crew and start reading", async () => {
    const payload = build({
      crew: [{ activityPersonId: randomUUID(), personId: driverId, role: "DRIVER" }],
      startReading: {
        readingId: randomUUID(),
        readingType: "ODOMETER",
        value: 412_880,
        observedAt: "2026-07-14T06:10:00Z",
      },
    });
    const response = await post(payload);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recordId: payload.activityId,
      rowVersion: 1,
      recordStatus: "OPEN",
    });

    const [activity] = await ctx.db
      .select()
      .from(activities)
      .where(eq(activities.id, payload.activityId));
    expect(activity).toMatchObject({
      status: "OPEN",
      completeness: null,
      completenessCodes: [],
      customerName: "Brasseries du Cameroun",
      clientReference: "WB-4471",
    });
    // {branchCode}-{year}-{seq5}, drawn per branch per year.
    expect(activity?.activityNumber).toMatch(/^DLA-2026-\d{5}$/);

    const segments = await ctx.db
      .select()
      .from(activityAssetSegments)
      .where(eq(activityAssetSegments.activityId, payload.activityId));
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      assetId: truckId,
      role: "PRIMARY",
      endedAt: null,
      startReadingId: payload.startReading?.readingId,
    });

    const crew = await ctx.db
      .select()
      .from(activityPeople)
      .where(eq(activityPeople.activityId, payload.activityId));
    expect(crew).toHaveLength(1);
    expect(crew[0]).toMatchObject({ personId: driverId, role: "DRIVER" });

    const readings = await ctx.db
      .select()
      .from(meterReadings)
      .where(eq(meterReadings.activityId, payload.activityId));
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({
      readingType: "ODOMETER",
      value: 412_880n,
      source: "ACTIVITY_START",
    });
  });

  it("numbers activities per branch per year, without gaps on retry", async () => {
    const first = await post(build());
    const second = await post(build());
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const numbers = await Promise.all(
      [first, second].map(async (response) => {
        const [row] = await ctx.db
          .select({ activityNumber: activities.activityNumber })
          .from(activities)
          .where(eq(activities.id, response.json().recordId));
        return row?.activityNumber ?? "";
      }),
    );
    const sequences = numbers.map((value) => Number(value.split("-")[2]));
    expect(sequences[1]).toBe((sequences[0] ?? 0) + 1);
  });

  it("replays an identical retry rather than opening a second job", async () => {
    const payload = build();
    const key = `idem-${randomUUID()}`;
    const first = await post(payload, { idempotencyKey: key });
    const second = await post(payload, { idempotencyKey: key });

    expect(first.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      recordId: payload.activityId,
      idempotentReplay: true,
    });

    const rows = await ctx.db
      .select()
      .from(activities)
      .where(eq(activities.id, payload.activityId));
    expect(rows).toHaveLength(1);
  });

  it("refuses to record a job against an asset that has left the fleet", async () => {
    const soldId = await seedAsset(ctx.app, managerToken, { assetCode: "CMR-TR-SOLD" });
    await ctx.db
      .update(assets)
      .set({ lifecycleStatus: "SOLD" })
      .where(and(eq(assets.workspaceId, workspaceId), eq(assets.id, soldId)));

    const response = await post(build({ primaryAssetId: soldId }));
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "ASSET_NOT_OPERATIONAL" } });
  });

  it("rejects an unknown activity type", async () => {
    const response = await post(build({ activityTypeCode: "NOT_A_TYPE" }));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "REFERENCE_NOT_FOUND", metadata: { referenceType: "activityType" } },
    });
  });

  it("rejects crew who are not registered people", async () => {
    const response = await post(
      build({
        crew: [{ activityPersonId: randomUUID(), personId: randomUUID(), role: "DRIVER" }],
      }),
    );
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "REFERENCE_NOT_FOUND", metadata: { referenceType: "person" } },
    });
  });

  it("lets a field clerk record a job without an approval round trip", async () => {
    const response = await post(build(), { token: clerkToken });
    expect(response.statusCode).toBe(200);
  });
});
