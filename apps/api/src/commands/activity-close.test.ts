import { randomUUID } from "node:crypto";
import {
  closeActivityCommand,
  createActivityCommand,
  recordMovementLegCommand,
  reopenActivityCommand,
} from "@routiq/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activities, activityAssetSegments } from "../db/schema.js";
import { createSession } from "../auth/local.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

describe("close-activity.v1 / reopen-activity.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  let managerToken: string;
  let clerkToken: string;
  let truckId: string;
  let driverId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    const manager = await seedMember(ctx.db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    managerToken = (
      await createSession(ctx.db, { workspaceId, principalId: manager.principal.id })
    ).token;
    const clerk = await seedMember(ctx.db, {
      workspaceId,
      role: "DRIVER",
      allBranches: true,
    });
    clerkToken = (
      await createSession(ctx.db, { workspaceId, principalId: clerk.principal.id })
    ).token;

    truckId = await seedAsset(ctx.app, managerToken, { assetCode: "CLOSE-TRUCK" });

    driverId = randomUUID();
    await ctx.app.inject({
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
        payload: { personId: driverId, displayName: "Ibrahim Njoya", branchCode: "DLA" },
      },
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** Recorded by the DRIVER unless told otherwise, so the DRIVER may close it. */
  async function openJob(
    opts: { withCrew?: boolean; withReading?: boolean; token?: string } = {},
  ): Promise<{ activityId: string; segmentId: string }> {
    const activityId = randomUUID();
    const segmentId = randomUUID();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/create-activity",
      headers: { authorization: `Bearer ${opts.token ?? clerkToken}` },
      payload: createActivityCommand.parse({
        name: "create-activity",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: {
          activityId,
          branchCode: "DLA",
          activityTypeCode: "HAULAGE_JOB",
          templateCode: "TRUCKING",
          primarySegmentId: segmentId,
          primaryAssetId: truckId,
          startedAt: "2026-07-14T06:10:00Z",
          ...(opts.withCrew === true
            ? { crew: [{ activityPersonId: randomUUID(), personId: driverId, role: "DRIVER" }] }
            : {}),
          ...(opts.withReading === true
            ? {
                startReading: {
                  readingId: randomUUID(),
                  readingType: "ODOMETER",
                  value: 412_880,
                  observedAt: "2026-07-14T06:10:00Z",
                },
              }
            : {}),
        },
      }),
    });
    expect(response.statusCode).toBe(200);
    return { activityId, segmentId };
  }

  async function addLeg(activityId: string, legNo: number) {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/record-movement-leg",
      headers: { authorization: `Bearer ${managerToken}` },
      payload: recordMovementLegCommand.parse({
        name: "record-movement-leg",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: {
          legId: randomUUID(),
          activityId,
          legNo,
          origin: { kind: "text", text: "Douala" },
          destination: { kind: "text", text: "Yaoundé" },
        },
      }),
    });
    expect(response.statusCode).toBe(200);
  }

  function close(
    activityId: string,
    opts: { expectedVersion?: number; endedAt?: string; token?: string } = {},
  ) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands/close-activity",
      headers: { authorization: `Bearer ${opts.token ?? clerkToken}` },
      payload: closeActivityCommand.parse({
        name: "close-activity",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
          expectedVersion: opts.expectedVersion ?? 1,
        },
        payload: {
          activityId,
          endedAt: opts.endedAt ?? "2026-07-15T09:00:00Z",
        },
      }),
    });
  }

  it("closes a job with missing data, recording what was missing", async () => {
    const { activityId } = await openJob();
    const response = await close(activityId);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      recordId: activityId,
      recordStatus: "COMPLETE_WITH_EXCEPTIONS",
      rowVersion: 2,
    });
    // The trailer hubodometer nobody read is a warning, not a refusal.
    expect(body.warnings).toEqual(
      expect.arrayContaining([
        "ACTIVITY_NO_LEGS",
        "ACTIVITY_MISSING_CREW",
        "ACTIVITY_NO_REVENUE",
        "ACTIVITY_MISSING_END_READING",
      ]),
    );

    const [activity] = await ctx.db
      .select()
      .from(activities)
      .where(eq(activities.id, activityId));
    expect(activity).toMatchObject({
      status: "CLOSED",
      completeness: "COMPLETE_WITH_EXCEPTIONS",
    });
    // Same vocabulary on the row as in the response — one list, not two.
    expect(activity?.completenessCodes).toEqual(body.warnings);
  });

  it("stamps dangling carrier segments instead of leaving them open", async () => {
    const { activityId, segmentId } = await openJob();
    await close(activityId);

    const [segment] = await ctx.db
      .select()
      .from(activityAssetSegments)
      .where(eq(activityAssetSegments.id, segmentId));
    // An open segment on a closed job would block this truck's next activity.
    expect(segment?.endedAt).not.toBeNull();
  });

  it("blocks the close when the trivial minimum is absent", async () => {
    const { activityId } = await openJob();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/close-activity",
      headers: { authorization: `Bearer ${clerkToken}` },
      payload: {
        name: "close-activity",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
          expectedVersion: 1,
          sourceArtifactIds: [],
        },
        payload: { activityId },
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: "ACTIVITY_CLOSE_BLOCKED",
        metadata: { blockedBy: ["MISSING_ACTUAL_DATES"] },
      },
    });
  });

  it("refuses to close twice", async () => {
    const { activityId } = await openJob();
    expect((await close(activityId)).statusCode).toBe(200);
    const again = await close(activityId, { expectedVersion: 2 });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: "INVALID_STATE_TRANSITION" } });
  });

  it("rejects a stale version", async () => {
    const { activityId } = await openJob();
    const response = await close(activityId, { expectedVersion: 99 });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "VERSION_CONFLICT" } });
  });

  it("reopens only for a manager, with a reason, clearing the verdict", async () => {
    const { activityId } = await openJob();
    expect((await close(activityId)).statusCode).toBe(200);

    const reopen = (token: string) =>
      ctx.app.inject({
        method: "POST",
        url: "/v1/commands/reopen-activity",
        headers: { authorization: `Bearer ${token}` },
        payload: reopenActivityCommand.parse({
          name: "reopen-activity",
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey: `idem-${randomUUID()}`,
            origin: "HUMAN_UI",
            expectedVersion: 2,
          },
          payload: { activityId, reason: "Feuille de route retrouvée" },
        }),
      });

    // A field clerk may close; only a manager may undo it.
    const denied = await reopen(clerkToken);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });

    const allowed = await reopen(managerToken);
    expect(allowed.statusCode).toBe(200);

    const [activity] = await ctx.db
      .select()
      .from(activities)
      .where(eq(activities.id, activityId));
    expect(activity).toMatchObject({
      status: "OPEN",
      completeness: null,
      completenessCodes: [],
      closedAt: null,
    });
  });

  it("refuses to reopen a job that is already open", async () => {
    const { activityId } = await openJob();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/reopen-activity",
      headers: { authorization: `Bearer ${managerToken}` },
      payload: reopenActivityCommand.parse({
        name: "reopen-activity",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
          expectedVersion: 1,
        },
        payload: { activityId, reason: "test" },
      }),
    });
    expect(response.statusCode).toBe(409);
  });

  it("closes clean when the legs and crew are actually there", async () => {
    const { activityId } = await openJob({ withCrew: true, withReading: true });
    await addLeg(activityId, 1);
    await addLeg(activityId, 2);

    const response = await close(activityId);
    expect(response.statusCode).toBe(200);
    // Revenue and the end reading are still absent — honestly reported.
    expect(response.json().warnings).toEqual(
      expect.arrayContaining(["ACTIVITY_NO_REVENUE", "ACTIVITY_MISSING_END_READING"]),
    );
    expect(response.json().warnings).not.toContain("ACTIVITY_NO_LEGS");
    expect(response.json().warnings).not.toContain("ACTIVITY_MISSING_CREW");
    expect(response.json().warnings).not.toContain("ACTIVITY_MISSING_START_READING");
  });

  /** docs/reference/roles-and-access.md: Chauffeur closes a trip, own only. */
  it("lets a DRIVER close only the trips they recorded", async () => {
    const { activityId } = await openJob({ token: managerToken });
    const refused = await close(activityId);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({
      error: { code: "OWN_RECORDS_ONLY", metadata: { entityType: "activity" } },
    });
    const [untouched] = await ctx.db
      .select()
      .from(activities)
      .where(eq(activities.id, activityId));
    expect(untouched?.status).toBe("OPEN");

    // A manager closes anyone's trip.
    const { activityId: driversTrip } = await openJob();
    expect((await close(driversTrip, { token: managerToken })).statusCode).toBe(200);
  });
});
