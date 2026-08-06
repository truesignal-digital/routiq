import { describe, expect, it } from "vitest";
import { setBranchStatusCommand } from "./set-branch-status.js";

const envelope = {
  commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  idempotencyKey: "set-branch-status-command",
  origin: "API",
  sourceArtifactIds: [],
};

const validStatusCommand = {
  name: "set-branch-status",
  version: 1,
  envelope,
  payload: {
    branchId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    active: false,
  },
};

describe("setBranchStatusCommand", () => {
  it("accepts a valid command", () => {
    expect(setBranchStatusCommand.parse(validStatusCommand).payload.active).toBe(
      false,
    );
  });

  it("accepts reactivation", () => {
    expect(
      setBranchStatusCommand.parse({
        ...validStatusCommand,
        payload: { ...validStatusCommand.payload, active: true },
      }).payload.active,
    ).toBe(true);
  });

  it("rejects a branch id that is not a uuid", () => {
    expect(
      setBranchStatusCommand.safeParse({
        ...validStatusCommand,
        payload: { ...validStatusCommand.payload, branchId: "DLA" },
      }).success,
    ).toBe(false);
  });

  it("rejects a non-boolean active flag", () => {
    expect(
      setBranchStatusCommand.safeParse({
        ...validStatusCommand,
        payload: { ...validStatusCommand.payload, active: "false" },
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown extra key due to strictObject", () => {
    expect(
      setBranchStatusCommand.safeParse({
        ...validStatusCommand,
        payload: { ...validStatusCommand.payload, extraField: "not-allowed" },
      }).success,
    ).toBe(false);
  });

  it("rejects missing active", () => {
    const { active: _active, ...withoutActive } = validStatusCommand.payload;

    expect(
      setBranchStatusCommand.safeParse({
        ...validStatusCommand,
        payload: withoutActive,
      }).success,
    ).toBe(false);
  });
});
