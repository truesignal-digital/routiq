import { describe, expect, it } from "vitest";
import {
  approveEntryCommand,
  rejectEntryCommand,
} from "./approve-entry.js";

const envelope = {
  commandId: "0d1f7a3c-0b6e-4a5f-9d2c-7e8b1a2c3d4e",
  idempotencyKey: "8d7c6b5a-4f3e-42d1-9c8b-7a6f5e4d3c2b",
  origin: "HUMAN_UI",
  sourceArtifactIds: [],
} as const;

const validApprove = {
  name: "approve-entry",
  version: 1,
  envelope,
  payload: {
    entryId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    note: "Reviewed against the receipt.",
  },
} as const;

const validReject = {
  name: "reject-entry",
  version: 1,
  envelope,
  payload: {
    entryId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    reason: "Receipt amount does not match.",
  },
} as const;

describe("approve-entry contract", () => {
  it("accepts a valid command with an optional note", () => {
    expect(approveEntryCommand.parse(validApprove).payload.note).toBe(
      "Reviewed against the receipt.",
    );
  });

  it("rejects a missing entryId", () => {
    const command = {
      ...validApprove,
      payload: { note: validApprove.payload.note },
    };

    expect(approveEntryCommand.safeParse(command).success).toBe(false);
  });

  it("rejects an invalid entryId UUID", () => {
    const command = {
      ...validApprove,
      payload: { ...validApprove.payload, entryId: "not-a-uuid" },
    };

    expect(approveEntryCommand.safeParse(command).success).toBe(false);
  });

  it("rejects an empty note", () => {
    const command = {
      ...validApprove,
      payload: { ...validApprove.payload, note: "" },
    };

    expect(approveEntryCommand.safeParse(command).success).toBe(false);
  });

  it("rejects a note longer than 500 characters", () => {
    const command = {
      ...validApprove,
      payload: { ...validApprove.payload, note: "x".repeat(501) },
    };

    expect(approveEntryCommand.safeParse(command).success).toBe(false);
  });
});

describe("reject-entry contract", () => {
  it("accepts a valid command", () => {
    expect(rejectEntryCommand.parse(validReject).payload.reason).toBe(
      "Receipt amount does not match.",
    );
  });

  it("rejects a missing entryId", () => {
    const command = {
      ...validReject,
      payload: { reason: validReject.payload.reason },
    };

    expect(rejectEntryCommand.safeParse(command).success).toBe(false);
  });

  it("rejects an invalid entryId UUID", () => {
    const command = {
      ...validReject,
      payload: { ...validReject.payload, entryId: "not-a-uuid" },
    };

    expect(rejectEntryCommand.safeParse(command).success).toBe(false);
  });

  it("rejects a missing reason", () => {
    const command = {
      ...validReject,
      payload: { entryId: validReject.payload.entryId },
    };

    expect(rejectEntryCommand.safeParse(command).success).toBe(false);
  });

  it("rejects an empty reason", () => {
    const command = {
      ...validReject,
      payload: { ...validReject.payload, reason: "" },
    };

    expect(rejectEntryCommand.safeParse(command).success).toBe(false);
  });

  it("rejects a reason longer than 500 characters", () => {
    const command = {
      ...validReject,
      payload: { ...validReject.payload, reason: "x".repeat(501) },
    };

    expect(rejectEntryCommand.safeParse(command).success).toBe(false);
  });
});
