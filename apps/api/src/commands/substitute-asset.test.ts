import { randomUUID } from "node:crypto";
import { createActivityCommand, substituteAssetCommand } from "@routiq/contracts";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityAssetSegments, meterReadings } from "../db/schema.js";
import { createSession } from "../auth/local.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

/** The Meiganga breakdown: one job, two tractors, one customer-facing activity. */
describe("substitute-asset.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let token: string;
  let tractorId: string;
  let reliefTractorId: string;
  let trailerId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await seedWorkspace(ctx.db);
    const member = await seedMember(ctx.db, {
      workspaceId: seeded.workspace.id,
      role: "OPS_MANAGER",
      allBranches: true,
    });
    token = (
      await createSession(ctx.db, {
        workspaceId: seeded.workspace.id,
        principalId: member.principal.id,
      })
    ).token;
    tractorId = await seedAsset(ctx.app, token, { assetCode: "CMR-TR-014" });
    reliefTractorId = await seedAsset(ctx.app, token, { assetCode: "CMR-TR-009" });
    trailerId = await seedAsset(ctx.app, token, { assetCode: "CMR-RM-007" });
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function openJob(): Promise<{ activityId: string; segmentId: string }> {
    const activityId = randomUUID();
    const segmentId = randomUUID();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/create-activity",
      headers: { authorization: `Bearer ${token}` },
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
          primaryAssetId: tractorId,
          startedAt: "2026-07-14T06:10:00Z",
          customerName: "Brasseries du Cameroun",
        },
      }),
    });
    expect(response.statusCode).toBe(200);
    return { activityId, segmentId };
  }

  function substitute(
    payload: Record<string, unknown>,
    opts: { expectedVersion?: number } = {},
  ) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands/substitute-asset",
      headers: { authorization: `Bearer ${token}` },
      payload: substituteAssetCommand.parse({
        name: "substitute-asset",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
          expectedVersion: opts.expectedVersion ?? 1,
        },
        payload,
      }),
    });
  }

  it("hands the job over without ever leaving two carriers on it", async () => {
    const { activityId, segmentId } = await openJob();
    const newSegmentId = randomUUID();
    const outgoingReadingId = randomUUID();
    const incomingReadingId = randomUUID();

    const response = await substitute({
      activityId,
      outgoingSegmentId: segmentId,
      newSegmentId,
      substituteAssetId: reliefTractorId,
      handoverAt: "2026-07-14T17:40:00Z",
      outgoingReading: {
        readingId: outgoingReadingId,
        readingType: "ODOMETER",
        value: 413_730,
        observedAt: "2026-07-14T17:40:00Z",
      },
      incomingReading: {
        readingId: incomingReadingId,
        readingType: "ODOMETER",
        value: 268_410,
        observedAt: "2026-07-14T17:40:00Z",
      },
      reason: "Panne d'embrayage à Meiganga",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ recordId: newSegmentId });

    const segments = await ctx.db
      .select()
      .from(activityAssetSegments)
      .where(eq(activityAssetSegments.activityId, activityId))
      .orderBy(asc(activityAssetSegments.startedAt));

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      assetId: tractorId,
      role: "PRIMARY",
      endedAt: new Date("2026-07-14T17:40:00Z"),
      endReadingId: outgoingReadingId,
      rowVersion: 2,
    });
    expect(segments[1]).toMatchObject({
      assetId: reliefTractorId,
      role: "SUBSTITUTE",
      substitutesSegmentId: segmentId,
      startedAt: new Date("2026-07-14T17:40:00Z"),
      endedAt: null,
      startReadingId: incomingReadingId,
    });

    // Exactly one open carrier afterwards — the invariant the whole command exists for.
    const open = segments.filter(
      (segment) =>
        segment.endedAt === null &&
        (segment.role === "PRIMARY" || segment.role === "SUBSTITUTE"),
    );
    expect(open).toHaveLength(1);

    const readings = await ctx.db
      .select()
      .from(meterReadings)
      .where(eq(meterReadings.activityId, activityId));
    expect(readings.filter((r) => r.source === "SUBSTITUTION")).toHaveLength(2);
    // §3.4 inv. 7: each asset carries only what it actually incurred — the
    // handover readings are what makes that computable.
    const outgoing = readings.find((r) => r.id === outgoingReadingId);
    expect(outgoing).toMatchObject({ assetId: tractorId, value: 413_730n });
  });

  it("can substitute again — the relief tractor hands over in its turn", async () => {
    const { activityId, segmentId } = await openJob();
    const second = randomUUID();
    expect(
      (
        await substitute({
          activityId,
          outgoingSegmentId: segmentId,
          newSegmentId: second,
          substituteAssetId: reliefTractorId,
          handoverAt: "2026-07-14T12:00:00Z",
        })
      ).statusCode,
    ).toBe(200);

    const third = randomUUID();
    const response = await substitute({
      activityId,
      outgoingSegmentId: second,
      newSegmentId: third,
      substituteAssetId: tractorId,
      handoverAt: "2026-07-14T18:00:00Z",
    });
    expect(response.statusCode).toBe(200);

    const segments = await ctx.db
      .select()
      .from(activityAssetSegments)
      .where(eq(activityAssetSegments.activityId, activityId));
    expect(segments).toHaveLength(3);
    expect(
      segments.filter((s) => s.endedAt === null && s.role !== "TRAILER"),
    ).toHaveLength(1);
  });

  it("requires the segment's version, and rejects a stale one", async () => {
    const { activityId, segmentId } = await openJob();

    const missing = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/substitute-asset",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "substitute-asset",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
          sourceArtifactIds: [],
        },
        payload: {
          activityId,
          outgoingSegmentId: segmentId,
          newSegmentId: randomUUID(),
          substituteAssetId: reliefTractorId,
          handoverAt: "2026-07-14T17:40:00Z",
        },
      },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({
      error: { code: "EXPECTED_VERSION_REQUIRED" },
    });

    const stale = await substitute(
      {
        activityId,
        outgoingSegmentId: segmentId,
        newSegmentId: randomUUID(),
        substituteAssetId: reliefTractorId,
        handoverAt: "2026-07-14T17:40:00Z",
      },
      { expectedVersion: 7 },
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: "VERSION_CONFLICT" } });
  });

  it("refuses to substitute a segment that already handed over", async () => {
    const { activityId, segmentId } = await openJob();
    expect(
      (
        await substitute({
          activityId,
          outgoingSegmentId: segmentId,
          newSegmentId: randomUUID(),
          substituteAssetId: reliefTractorId,
          handoverAt: "2026-07-14T17:40:00Z",
        })
      ).statusCode,
    ).toBe(200);

    const again = await substitute(
      {
        activityId,
        outgoingSegmentId: segmentId,
        newSegmentId: randomUUID(),
        substituteAssetId: trailerId,
        handoverAt: "2026-07-14T19:00:00Z",
      },
      { expectedVersion: 2 },
    );
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({
      error: { code: "INVALID_STATE_TRANSITION", metadata: { reason: "already closed" } },
    });
  });

  it("rejects a handover before the segment even started", async () => {
    const { activityId, segmentId } = await openJob();
    const response = await substitute({
      activityId,
      outgoingSegmentId: segmentId,
      newSegmentId: randomUUID(),
      substituteAssetId: reliefTractorId,
      handoverAt: "2026-07-13T00:00:00Z",
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("rejects substituting an asset for itself", async () => {
    const { activityId, segmentId } = await openJob();
    const response = await substitute({
      activityId,
      outgoingSegmentId: segmentId,
      newSegmentId: randomUUID(),
      substituteAssetId: tractorId,
      handoverAt: "2026-07-14T17:40:00Z",
    });
    expect(response.statusCode).toBe(422);
  });

  it("replays an identical retry rather than opening a third segment", async () => {
    const { activityId, segmentId } = await openJob();
    const newSegmentId = randomUUID();
    const key = `idem-${randomUUID()}`;
    const commandId = randomUUID();
    const envelope = {
      commandId,
      idempotencyKey: key,
      origin: "HUMAN_UI" as const,
      expectedVersion: 1,
      sourceArtifactIds: [],
    };
    const payload = {
      activityId,
      outgoingSegmentId: segmentId,
      newSegmentId,
      substituteAssetId: reliefTractorId,
      handoverAt: "2026-07-14T17:40:00Z",
    };
    const send = () =>
      ctx.app.inject({
        method: "POST",
        url: "/v1/commands/substitute-asset",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "substitute-asset", version: 1, envelope, payload },
      });

    expect((await send()).statusCode).toBe(200);
    const replay = await send();
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ idempotentReplay: true });

    const segments = await ctx.db
      .select()
      .from(activityAssetSegments)
      .where(eq(activityAssetSegments.activityId, activityId));
    expect(segments).toHaveLength(2);
  });
});
