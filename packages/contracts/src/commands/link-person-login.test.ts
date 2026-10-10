import { describe, expect, it } from "vitest";
import { linkPersonLoginCommand } from "./link-person-login.js";

const envelope = {
  commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  idempotencyKey: "link-001",
  origin: "HUMAN_UI" as const,
  expectedVersion: 1,
};
const personId = "550e8400-e29b-41d4-a716-446655440000";
const principalId = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function rejectedPaths(input: unknown): string[] {
  const result = linkPersonLoginCommand.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("link-person-login contract", () => {
  const valid = {
    name: "link-person-login",
    version: 1,
    envelope,
    payload: { personId, principalId },
  };

  it("names the person and the login by their ids", () => {
    expect(linkPersonLoginCommand.parse(valid).payload).toEqual({ personId, principalId });
  });

  it("rejects a missing login", () => {
    expect(rejectedPaths({ ...valid, payload: { personId } })).toEqual(["payload.principalId"]);
  });

  it("rejects a person id that is not a uuid", () => {
    expect(rejectedPaths({ ...valid, payload: { personId: "CH-014", principalId } })).toEqual([
      "payload.personId",
    ]);
  });

  it("refuses a membership row id or any other extra field", () => {
    expect(
      rejectedPaths({ ...valid, payload: { personId, principalId, membershipId: principalId } }),
    ).toEqual(["payload"]);
  });
});
