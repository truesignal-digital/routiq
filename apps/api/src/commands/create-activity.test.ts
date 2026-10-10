import { randomUUID } from "node:crypto";
import {
  createActivityCommand,
  createActivityPayload,
  registerPersonCommand,
} from "@routiq/contracts";
import { and, eq, inArray } from "drizzle-orm";
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
import { apiClient } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";
import { setModule } from "../test/vendor.js";

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
      role: "DRIVER",
      allBranches: true,
    });
    clerkToken = (
      await createSession(ctx.db, { workspaceId, principalId: clerk.principal.id })
    ).token;

    const manager = await seedMember(ctx.db, {
      workspaceId,
      role: "ADMIN",
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
    opts: { token?: string; idempotencyKey?: string; origin?: "HUMAN_UI" | "OFFLINE_SYNC" } = {},
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
          origin: opts.origin ?? "HUMAN_UI",
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

  /**
   * #577, ADR-0012 §4: a vehicle already on another unfinished trip may start
   * a second one. The start is a fact; it is accepted and warns, naming the
   * other trip, so someone closes the stale one.
   */
  describe("on a vehicle already on another unfinished trip", () => {
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

    for (const origin of ["HUMAN_UI", "OFFLINE_SYNC"] as const) {
      it(`${origin}: starts the second trip and warns VEHICLE_DOUBLE_BOOKED with the other trip`, async () => {
        const truck = await seedAsset(ctx.app, managerToken);
        const stale = build({ primaryAssetId: truck, startedAt: minutesAgo(180) });
        const staleReply = await post(stale, { origin });
        expect(staleReply.statusCode).toBe(200);
        expect(staleReply.json().warnings).toEqual([]);

        const second = build({ primaryAssetId: truck, startedAt: minutesAgo(60) });
        const reply = await post(second, { origin });
        expect(reply.statusCode, reply.body).toBe(200);
        expect(reply.json()).toMatchObject({
          recordId: second.activityId,
          recordStatus: "OPEN",
          warnings: ["VEHICLE_DOUBLE_BOOKED"],
          warningMetadata: { VEHICLE_DOUBLE_BOOKED: { tripIds: [stale.activityId] } },
        });

        // Both trips are recorded and still open: nothing is closed for the user.
        const rows = await ctx.db
          .select({ id: activities.id, status: activities.status })
          .from(activities)
          .where(and(eq(activities.workspaceId, workspaceId), inArray(activities.id, [stale.activityId, second.activityId])));
        expect(rows.map((row) => row.status)).toEqual(["OPEN", "OPEN"]);
      });
    }

    // A phone clock a few minutes fast is ordinary: the truck is still on the
    // other open trip, whatever the start's stamp says.
    it("warns when the start is stamped ahead of the server clock", async () => {
      const truck = await seedAsset(ctx.app, managerToken);
      const stale = build({ primaryAssetId: truck, startedAt: minutesAgo(60) });
      await post(stale);
      const reply = await post(build({ primaryAssetId: truck, startedAt: minutesAgo(-2) }));
      expect(reply.statusCode, reply.body).toBe(200);
      expect(reply.json()).toMatchObject({
        warnings: ["VEHICLE_DOUBLE_BOOKED"],
        warningMetadata: { VEHICLE_DOUBLE_BOOKED: { tripIds: [stale.activityId] } },
      });
    });

    it("does not warn once the other trip is closed, or for another vehicle", async () => {
      const truck = await seedAsset(ctx.app, managerToken);
      const done = build({ primaryAssetId: truck, startedAt: minutesAgo(240) });
      await post(done);
      const close = await ctx.app.inject({
        method: "POST",
        url: "/v1/commands/close-activity",
        headers: { authorization: `Bearer ${managerToken}` },
        payload: {
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey: `idem-${randomUUID()}`,
            origin: "HUMAN_UI",
            expectedVersion: 1,
          },
          payload: { activityId: done.activityId, endedAt: minutesAgo(200) },
        },
      });
      expect(close.statusCode, close.body).toBe(200);

      const next = await post(build({ primaryAssetId: truck, startedAt: minutesAgo(30) }));
      expect(next.json().warnings).toEqual([]);
      expect(next.json()).not.toHaveProperty("warningMetadata");

      const other = await seedAsset(ctx.app, managerToken);
      const elsewhere = await post(build({ primaryAssetId: other, startedAt: minutesAgo(30) }));
      expect(elsewhere.json().warnings).toEqual([]);
    });
  });

  /**
   * #653, ADR-0012 §4: a start also warns when its vehicle is grounded and
   * when its driver is still on another unfinished trip. Facts, so accepted;
   * the warnings say what to fix.
   */
  describe("on a grounded vehicle or with a driver already out", () => {
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    const api = () => apiClient(ctx.app);

    async function registerDriver(): Promise<string> {
      const personId = randomUUID();
      await api().ok(managerToken, "register-person", {
        personId,
        displayName: `driver-${personId.slice(0, 6)}`,
        branchCode: "DLA",
        defaultRole: "DRIVER",
      });
      return personId;
    }

    async function groundedTruck(): Promise<string> {
      const truck = await seedAsset(ctx.app, managerToken);
      await api().ok(managerToken, "report-issue", {
        issueId: randomUUID(),
        assetId: truck,
        description: "Freins qui lâchent",
        safetyCritical: true,
      });
      return truck;
    }

    const crewOf = (personId: string, role: "DRIVER" | "CONDUCTOR" = "DRIVER") => [
      { activityPersonId: randomUUID(), personId, role },
    ];

    for (const origin of ["HUMAN_UI", "OFFLINE_SYNC"] as const) {
      it(`${origin}: starts on a grounded vehicle and warns VEHICLE_GROUNDED`, async () => {
        const truck = await groundedTruck();
        const payload = build({ primaryAssetId: truck, startedAt: minutesAgo(30) });
        const reply = await post(payload, { origin });
        expect(reply.statusCode, reply.body).toBe(200);
        expect(reply.json()).toMatchObject({ recordStatus: "OPEN", warnings: ["VEHICLE_GROUNDED"] });
        expect(reply.json()).not.toHaveProperty("warningMetadata");
      });

      it(`${origin}: warns DRIVER_DOUBLE_BOOKED with the trip the driver is still on`, async () => {
        const person = await registerDriver();
        const stale = build({
          primaryAssetId: await seedAsset(ctx.app, managerToken),
          startedAt: minutesAgo(180),
          crew: crewOf(person),
        });
        expect((await post(stale, { origin })).json().warnings).toEqual([]);

        const second = build({
          primaryAssetId: await seedAsset(ctx.app, managerToken),
          startedAt: minutesAgo(60),
          crew: crewOf(person),
        });
        const reply = await post(second, { origin });
        expect(reply.statusCode, reply.body).toBe(200);
        expect(reply.json()).toMatchObject({
          recordStatus: "OPEN",
          warnings: ["DRIVER_DOUBLE_BOOKED"],
          warningMetadata: { DRIVER_DOUBLE_BOOKED: { tripIds: [stale.activityId] } },
        });
      });
    }

    it("does not warn VEHICLE_GROUNDED while Maintenance is off", async () => {
      const truck = await groundedTruck();
      await setModule(ctx.db, workspaceId, "MAINTENANCE", false);
      try {
        const reply = await post(build({ primaryAssetId: truck, startedAt: minutesAgo(30) }));
        expect(reply.statusCode, reply.body).toBe(200);
        expect(reply.json().warnings).toEqual([]);
      } finally {
        await setModule(ctx.db, workspaceId, "MAINTENANCE", true);
      }
    });

    // The window rule alone misses a start stamped ahead of now(): the driver
    // is still on the other open trip, whatever the stamp says.
    it("warns DRIVER_DOUBLE_BOOKED when the start is stamped ahead of the server clock", async () => {
      const person = await registerDriver();
      const stale = build({
        primaryAssetId: await seedAsset(ctx.app, managerToken),
        startedAt: minutesAgo(60),
        crew: crewOf(person),
      });
      await post(stale);
      const reply = await post(
        build({
          primaryAssetId: await seedAsset(ctx.app, managerToken),
          startedAt: minutesAgo(-2),
          crew: crewOf(person),
        }),
      );
      expect(reply.statusCode, reply.body).toBe(200);
      expect(reply.json()).toMatchObject({
        warnings: ["DRIVER_DOUBLE_BOOKED"],
        warningMetadata: { DRIVER_DOUBLE_BOOKED: { tripIds: [stale.activityId] } },
      });
    });

    it("does not warn for a driver whose other trip is closed, or who rode as conductor", async () => {
      const person = await registerDriver();
      const done = build({
        primaryAssetId: await seedAsset(ctx.app, managerToken),
        startedAt: minutesAgo(240),
        crew: crewOf(person),
      });
      await post(done);
      await api().ok(
        managerToken,
        "close-activity",
        { activityId: done.activityId, endedAt: minutesAgo(200) },
        { expectedVersion: 1 },
      );
      const riding = build({
        primaryAssetId: await seedAsset(ctx.app, managerToken),
        startedAt: minutesAgo(120),
        crew: crewOf(person, "CONDUCTOR"),
      });
      await post(riding);

      const next = await post(
        build({
          primaryAssetId: await seedAsset(ctx.app, managerToken),
          startedAt: minutesAgo(30),
          crew: crewOf(person),
        }),
      );
      expect(next.statusCode, next.body).toBe(200);
      expect(next.json().warnings).toEqual([]);
      expect(next.json()).not.toHaveProperty("warningMetadata");
    });

    // A sheet saves open with its end already set; closing is a later click.
    // A trip that ended yesterday does not hold its driver today.
    it("does not warn for a driver whose sheet ended but is still open", async () => {
      const person = await registerDriver();
      const sheet = await api().send(managerToken, "record-haulage-job-sheet", {
        activityId: randomUUID(),
        branchCode: "DLA",
        activityTypeCode: "HAULAGE_JOB",
        primarySegmentId: randomUUID(),
        primaryAssetId: await seedAsset(ctx.app, managerToken),
        startedAt: minutesAgo(26 * 60),
        endedAt: minutesAgo(22 * 60),
        crew: crewOf(person),
        extraSegments: [],
        legs: [
          {
            legId: randomUUID(),
            legNo: 1,
            origin: { kind: "text", text: "Douala" },
            destination: { kind: "text", text: "Yaoundé" },
            loadState: "LADEN",
          },
        ],
        entries: [],
        close: false,
      });
      expect(sheet.status, JSON.stringify(sheet.body)).toBe(200);
      expect(sheet.body).toMatchObject({ recordStatus: "OPEN" });

      const next = await post(
        build({
          primaryAssetId: await seedAsset(ctx.app, managerToken),
          startedAt: minutesAgo(30),
          crew: crewOf(person),
        }),
      );
      expect(next.statusCode, next.body).toBe(200);
      expect(next.json().warnings).toEqual([]);
      expect(next.json()).not.toHaveProperty("warningMetadata");
    });

    it("an exact retry returns every warning of the first start", async () => {
      const person = await registerDriver();
      const truck = await groundedTruck();
      const stale = build({ primaryAssetId: truck, startedAt: minutesAgo(180), crew: crewOf(person) });
      await post(stale, { origin: "OFFLINE_SYNC" });

      const payload = build({ primaryAssetId: truck, startedAt: minutesAgo(60), crew: crewOf(person) });
      const envelope = {
        commandId: randomUUID(),
        idempotencyKey: `idem-${randomUUID()}`,
        origin: "OFFLINE_SYNC" as const,
      };
      const send = () =>
        ctx.app.inject({
          method: "POST",
          url: "/v1/commands/create-activity",
          headers: { authorization: `Bearer ${clerkToken}` },
          payload: createActivityCommand.parse({ name: "create-activity", version: 1, envelope, payload }),
        });
      const first = await send();
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json()).toMatchObject({
        warnings: ["VEHICLE_DOUBLE_BOOKED", "VEHICLE_GROUNDED", "DRIVER_DOUBLE_BOOKED"],
        warningMetadata: {
          VEHICLE_DOUBLE_BOOKED: { tripIds: [stale.activityId] },
          DRIVER_DOUBLE_BOOKED: { tripIds: [stale.activityId] },
        },
      });

      const retry = await send();
      expect(retry.statusCode, retry.body).toBe(200);
      expect(retry.json()).toEqual({ ...first.json(), idempotentReplay: true });
    });
  });
});
