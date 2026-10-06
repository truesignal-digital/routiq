import { describe, expect, it } from "vitest";
import { acknowledgeApprovalRulesPayload } from "./acknowledge-approval-rules.js";
import { COMMAND_QUEUEABILITY } from "./queueability.js";

const changeId = "3f6b2a7c-9d41-4a52-8b0e-2c1d5e6f7a8b";

describe("acknowledgeApprovalRulesPayload", () => {
  it("names the change the member has read", () => {
    expect(acknowledgeApprovalRulesPayload.parse({ changeId })).toEqual({ changeId });
  });

  it("refuses a missing or malformed change id", () => {
    expect(acknowledgeApprovalRulesPayload.safeParse({}).success).toBe(false);
    expect(acknowledgeApprovalRulesPayload.safeParse({ changeId: "c1" }).success).toBe(false);
  });

  it("takes nothing the server derives: who acknowledges comes from the session", () => {
    expect(
      acknowledgeApprovalRulesPayload.safeParse({ changeId, membershipId: changeId }).success,
    ).toBe(false);
  });

  it("is not queued offline: it answers the rules the server holds now", () => {
    expect(COMMAND_QUEUEABILITY["acknowledge-approval-rules"]).toBe(false);
  });
});
