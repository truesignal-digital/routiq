import { describe, expect, it } from "vitest";
import { COMMAND_QUEUEABILITY } from "./queueability.js";
import {
  assignTripCommand,
  cancelPlannedTripCommand,
  planTripCommand,
  rescheduleTripCommand,
  startPlannedTripCommand,
  updatePlannedTripCommand,
} from "./plan-trip.js";

const envelope = {
  commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  idempotencyKey: "plan-trip-0001",
  origin: "HUMAN_UI" as const,
};
const TRIP = "550e8400-e29b-41d4-a716-446655440000";
const ASSET = "6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607";
const PERSON = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";

const booking = {
  activityId: TRIP,
  branchCode: "DLA",
  activityTypeCode: "HAULAGE_JOB",
  templateCode: "TRUCKING" as const,
  plannedStartAt: "2026-10-15T06:00:00+01:00",
};

function plan(payload: Record<string, unknown>) {
  return planTripCommand.safeParse({ name: "plan-trip", version: 1, envelope, payload });
}

describe("plan-trip.v1", () => {
  it("books a trip with planned dates and no actual start, vehicle or driver", () => {
    const parsed = plan(booking);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.payload).not.toHaveProperty("startedAt");
    expect(parsed.data?.payload.plannedAssetId).toBeUndefined();
    expect(parsed.data?.payload.plannedDriverPersonId).toBeUndefined();
    expect(parsed.data?.payload.customValues).toEqual({});
  });

  it("carries the plan: vehicle, driver, route, cargo and integer XAF prices", () => {
    const parsed = plan({
      ...booking,
      plannedEndAt: "2026-10-15T18:00:00+01:00",
      plannedAssetId: ASSET,
      plannedDriverPersonId: PERSON,
      customerName: "Cimencam",
      description: "30 t de ciment",
      origin: { kind: "place", placeId: TRIP, name: "Douala" },
      destination: { kind: "text", text: "Yaoundé, dépôt Mvan" },
      agreedPriceMinor: 450_000,
      amountToCollectMinor: 0,
    });
    expect(parsed.success).toBe(true);
  });

  it("requires a planned start", () => {
    expect(plan({ ...booking, plannedStartAt: undefined }).success).toBe(false);
  });

  it("refuses a planned end at or before the planned start", () => {
    expect(plan({ ...booking, plannedEndAt: booking.plannedStartAt }).success).toBe(false);
    expect(plan({ ...booking, plannedEndAt: "2026-10-15T04:00:00Z" }).success).toBe(false);
  });

  it("refuses negative or fractional prices", () => {
    expect(plan({ ...booking, agreedPriceMinor: -1 }).success).toBe(false);
    expect(plan({ ...booking, agreedPriceMinor: 1000.5 }).success).toBe(false);
    expect(plan({ ...booking, amountToCollectMinor: -5 }).success).toBe(false);
  });
});

describe("the planned-trip edits", () => {
  it("assign-trip states both halves of the assignment; null clears one", () => {
    const base = { name: "assign-trip", version: 1, envelope };
    expect(
      assignTripCommand.safeParse({
        ...base,
        payload: { activityId: TRIP, plannedAssetId: ASSET, plannedDriverPersonId: null },
      }).success,
    ).toBe(true);
    expect(
      assignTripCommand.safeParse({ ...base, payload: { activityId: TRIP, plannedAssetId: ASSET } })
        .success,
    ).toBe(false);
  });

  it("reschedule-trip keeps the end after the start", () => {
    const base = { name: "reschedule-trip", version: 1, envelope };
    expect(
      rescheduleTripCommand.safeParse({
        ...base,
        payload: { activityId: TRIP, plannedStartAt: "2026-10-16T06:00:00Z" },
      }).success,
    ).toBe(true);
    expect(
      rescheduleTripCommand.safeParse({
        ...base,
        payload: {
          activityId: TRIP,
          plannedStartAt: "2026-10-16T06:00:00Z",
          plannedEndAt: "2026-10-16T05:00:00Z",
        },
      }).success,
    ).toBe(false);
  });

  it("update-planned-trip takes a patch, null clears, and an empty patch is refused", () => {
    const base = { name: "update-planned-trip", version: 1, envelope };
    expect(
      updatePlannedTripCommand.safeParse({
        ...base,
        payload: { activityId: TRIP, agreedPriceMinor: 500_000, clientReference: null },
      }).success,
    ).toBe(true);
    expect(
      updatePlannedTripCommand.safeParse({ ...base, payload: { activityId: TRIP } }).success,
    ).toBe(false);
  });

  it("cancel-planned-trip needs a listed reason, and words for OTHER", () => {
    const base = { name: "cancel-planned-trip", version: 1, envelope };
    expect(
      cancelPlannedTripCommand.safeParse({
        ...base,
        payload: { activityId: TRIP, reason: "CUSTOMER_CANCELLED" },
      }).success,
    ).toBe(true);
    expect(
      cancelPlannedTripCommand.safeParse({ ...base, payload: { activityId: TRIP, reason: "OTHER" } })
        .success,
    ).toBe(false);
    expect(
      cancelPlannedTripCommand.safeParse({
        ...base,
        payload: { activityId: TRIP, reason: "OTHER", note: "Route coupée à Edéa" },
      }).success,
    ).toBe(true);
    expect(
      cancelPlannedTripCommand.safeParse({ ...base, payload: { activityId: TRIP, reason: "LATE" } })
        .success,
    ).toBe(false);
  });

  it("start-planned-trip requires the vehicle that left and the actual start", () => {
    const base = { name: "start-planned-trip", version: 1, envelope };
    const start = {
      activityId: TRIP,
      primarySegmentId: ASSET,
      primaryAssetId: ASSET,
      startedAt: "2026-10-15T06:20:00+01:00",
    };
    expect(startPlannedTripCommand.parse({ ...base, payload: start }).payload.crew).toEqual([]);
    expect(
      startPlannedTripCommand.safeParse({ ...base, payload: { ...start, primaryAssetId: undefined } })
        .success,
    ).toBe(false);
    expect(
      startPlannedTripCommand.safeParse({ ...base, payload: { ...start, startedAt: undefined } })
        .success,
    ).toBe(false);
  });
});

describe("planned-trip queueability (ADR-0012 §5)", () => {
  it("queues the facts and keeps the decisions online", () => {
    expect(COMMAND_QUEUEABILITY["plan-trip"]).toBe(true);
    expect(COMMAND_QUEUEABILITY["start-planned-trip"]).toBe(true);
    expect(COMMAND_QUEUEABILITY["assign-trip"]).toBe(false);
    expect(COMMAND_QUEUEABILITY["reschedule-trip"]).toBe(false);
    expect(COMMAND_QUEUEABILITY["update-planned-trip"]).toBe(false);
    expect(COMMAND_QUEUEABILITY["cancel-planned-trip"]).toBe(false);
  });
});
