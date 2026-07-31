import { describe, expect, it } from "vitest";
import {
  recordHaulageJobSheetCommand,
  recordHaulageJobSheetPayload,
  recordJourneySheetCommand,
  recordJourneySheetPayload,
} from "./record-journey-sheet.js";

const sheet = {
  activityId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  branchCode: "DLA",
  activityTypeCode: "SCHEDULED_JOURNEY",
  primarySegmentId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
  primaryAssetId: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
  startedAt: "2026-07-16T06:00:00+01:00",
  endedAt: "2026-07-16T11:00:00+01:00",
} as const;

const valid = {
  name: "record-journey-sheet",
  version: 1,
  envelope: {
    commandId: "0d1f7a3c-0b6e-4a5f-9d2c-7e8b1a2c3d4e",
    idempotencyKey: "device1-0001",
    origin: "HUMAN_UI",
    sourceArtifactIds: [],
  },
  payload: sheet,
} as const;

describe("record-journey-sheet contract", () => {
  it("accepts a valid command", () => {
    expect(recordJourneySheetCommand.parse(valid).payload.branchCode).toBe("DLA");
  });

  // Recording states facts; closing is a separate human decision. A sheet that
  // said nothing about closing must never come back closed.
  it("leaves the activity open when the sheet does not ask to close it", () => {
    expect(recordJourneySheetPayload.parse(sheet).close).toBe(false);
    expect(recordHaulageJobSheetPayload.parse(sheet).close).toBe(false);
  });

  it("carries an explicit close through both flavours", () => {
    expect(recordJourneySheetPayload.parse({ ...sheet, close: true }).close).toBe(true);
    expect(
      recordHaulageJobSheetCommand.parse({
        ...valid,
        name: "record-haulage-job-sheet",
        payload: { ...sheet, close: true },
      }).payload.close,
    ).toBe(true);
  });

  it("rejects a close that is not a boolean", () => {
    expect(recordJourneySheetPayload.safeParse({ ...sheet, close: "true" }).success).toBe(
      false,
    );
  });
});
