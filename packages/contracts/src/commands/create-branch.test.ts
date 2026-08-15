import { describe, expect, it } from "vitest";
import { createBranchCommand } from "./create-branch.js";

const envelope = {
  commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  idempotencyKey: "create-branch-command",
  origin: "API",
  sourceArtifactIds: [],
};

const validCreateCommand = {
  name: "create-branch",
  version: 1,
  envelope,
  payload: {
    branchId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    code: "YDE",
    name: "Yaoundé",
  },
};

describe("createBranchCommand", () => {
  it("accepts a valid command", () => {
    expect(createBranchCommand.parse(validCreateCommand).payload.code).toBe(
      "YDE",
    );
  });

  it("rejects a lowercase branch code", () => {
    expect(
      createBranchCommand.safeParse({
        ...validCreateCommand,
        payload: { ...validCreateCommand.payload, code: "yde" },
      }).success,
    ).toBe(false);
  });

  it("rejects a 1-character code", () => {
    expect(
      createBranchCommand.safeParse({
        ...validCreateCommand,
        payload: { ...validCreateCommand.payload, code: "Y" },
      }).success,
    ).toBe(false);
  });

  it("rejects a 9-character code", () => {
    expect(
      createBranchCommand.safeParse({
        ...validCreateCommand,
        payload: { ...validCreateCommand.payload, code: "ABCDEFGHI" },
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown extra key due to strictObject", () => {
    expect(
      createBranchCommand.safeParse({
        ...validCreateCommand,
        payload: { ...validCreateCommand.payload, extraField: "not-allowed" },
      }).success,
    ).toBe(false);
  });

  it("rejects a whitespace-only name", () => {
    expect(
      createBranchCommand.safeParse({
        ...validCreateCommand,
        payload: { ...validCreateCommand.payload, name: "   " },
      }).success,
    ).toBe(false);
  });

  it("trims a padded name rather than persisting the padding", () => {
    expect(
      createBranchCommand.parse({
        ...validCreateCommand,
        payload: { ...validCreateCommand.payload, name: "  Yaoundé  " },
      }).payload.name,
    ).toBe("Yaoundé");
  });

  it("rejects a name over 120 characters", () => {
    expect(
      createBranchCommand.safeParse({
        ...validCreateCommand,
        payload: { ...validCreateCommand.payload, name: "a".repeat(121) },
      }).success,
    ).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _name, ...withoutName } = validCreateCommand.payload;

    expect(
      createBranchCommand.safeParse({
        ...validCreateCommand,
        payload: withoutName,
      }).success,
    ).toBe(false);
  });
});
