import { describe, expect, it } from "vitest";
import { renameBranchCommand } from "./rename-branch.js";

const envelope = {
  commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  idempotencyKey: "rename-branch-command",
  origin: "API",
  sourceArtifactIds: [],
  expectedVersion: 1,
};

const validRenameCommand = {
  name: "rename-branch",
  version: 1,
  envelope,
  payload: {
    branchId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    name: "Douala — Bonabéri",
  },
};

describe("renameBranchCommand", () => {
  it("accepts a valid command", () => {
    expect(renameBranchCommand.parse(validRenameCommand).payload.name).toBe(
      "Douala — Bonabéri",
    );
  });

  it("rejects a branch id that is not a uuid", () => {
    expect(
      renameBranchCommand.safeParse({
        ...validRenameCommand,
        payload: { ...validRenameCommand.payload, branchId: "DLA" },
      }).success,
    ).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(
      renameBranchCommand.safeParse({
        ...validRenameCommand,
        payload: { ...validRenameCommand.payload, name: "" },
      }).success,
    ).toBe(false);
  });

  it("rejects a whitespace-only name", () => {
    expect(
      renameBranchCommand.safeParse({
        ...validRenameCommand,
        payload: { ...validRenameCommand.payload, name: "   " },
      }).success,
    ).toBe(false);
  });

  it("trims a padded name rather than persisting the padding", () => {
    expect(
      renameBranchCommand.parse({
        ...validRenameCommand,
        payload: { ...validRenameCommand.payload, name: "  Douala  " },
      }).payload.name,
    ).toBe("Douala");
  });

  it("rejects a name over 120 characters", () => {
    expect(
      renameBranchCommand.safeParse({
        ...validRenameCommand,
        payload: { ...validRenameCommand.payload, name: "a".repeat(121) },
      }).success,
    ).toBe(false);
  });

  it("rejects a code, because branch codes are immutable", () => {
    expect(
      renameBranchCommand.safeParse({
        ...validRenameCommand,
        payload: { ...validRenameCommand.payload, code: "BON" },
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown extra key due to strictObject", () => {
    expect(
      renameBranchCommand.safeParse({
        ...validRenameCommand,
        payload: { ...validRenameCommand.payload, extraField: "not-allowed" },
      }).success,
    ).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _name, ...withoutName } = validRenameCommand.payload;

    expect(
      renameBranchCommand.safeParse({
        ...validRenameCommand,
        payload: withoutName,
      }).success,
    ).toBe(false);
  });
});
