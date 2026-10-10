import { describe, expect, it } from "vitest";
import { unlinkPersonLoginCommand } from "./unlink-person-login.js";

const envelope = {
  commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  idempotencyKey: "unlink-001",
  origin: "HUMAN_UI" as const,
  expectedVersion: 2,
};
const personId = "550e8400-e29b-41d4-a716-446655440000";

function rejectedPaths(input: unknown): string[] {
  const result = unlinkPersonLoginCommand.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("unlink-person-login contract", () => {
  const valid = { name: "unlink-person-login", version: 1, envelope, payload: { personId } };

  it("names only the person", () => {
    expect(unlinkPersonLoginCommand.parse(valid).payload).toEqual({ personId });
  });

  it("rejects a missing person", () => {
    expect(rejectedPaths({ ...valid, payload: {} })).toEqual(["payload.personId"]);
  });

  it("refuses a login in the payload: unlinking ends whichever link is current", () => {
    expect(
      rejectedPaths({
        ...valid,
        payload: { personId, principalId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" },
      }),
    ).toEqual(["payload"]);
  });
});
