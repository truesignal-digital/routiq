import { describe, expect, it } from "vitest";
import { reverseEntryCommand } from "./reverse-entry.js";

const valid = {
  name: "reverse-entry",
  version: 1,
  envelope: {
    commandId: "0d1f7a3c-0b6e-4a5f-9d2c-7e8b1a2c3d4e",
    idempotencyKey: "8d7c6b5a-4f3e-42d1-9c8b-7a6f5e4d3c2b",
    origin: "HUMAN_UI",
    sourceArtifactIds: [],
  },
  payload: {
    reversalEntryId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    originalEntryId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
    reason: "Duplicate entry.",
  },
} as const;

describe("reverse-entry contract", () => {
  it("accepts a valid command", () => {
    expect(reverseEntryCommand.parse(valid).payload.reason).toBe(
      "Duplicate entry.",
    );
  });

  it("rejects an invalid reversalEntryId UUID", () => {
    const command = {
      ...valid,
      payload: { ...valid.payload, reversalEntryId: "not-a-uuid" },
    };

    expect(reverseEntryCommand.safeParse(command).success).toBe(false);
  });

  it("rejects an invalid originalEntryId UUID", () => {
    const command = {
      ...valid,
      payload: { ...valid.payload, originalEntryId: "not-a-uuid" },
    };

    expect(reverseEntryCommand.safeParse(command).success).toBe(false);
  });

  it("rejects a missing reason", () => {
    const command = {
      ...valid,
      payload: {
        reversalEntryId: valid.payload.reversalEntryId,
        originalEntryId: valid.payload.originalEntryId,
      },
    };

    expect(reverseEntryCommand.safeParse(command).success).toBe(false);
  });

  it("rejects an empty reason", () => {
    const command = {
      ...valid,
      payload: { ...valid.payload, reason: "" },
    };

    expect(reverseEntryCommand.safeParse(command).success).toBe(false);
  });

  it("rejects a reason longer than 500 characters", () => {
    const command = {
      ...valid,
      payload: { ...valid.payload, reason: "x".repeat(501) },
    };

    expect(reverseEntryCommand.safeParse(command).success).toBe(false);
  });
});
