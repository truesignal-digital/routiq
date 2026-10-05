import { describe, expect, it } from "vitest";
import { appointDirectorPayload } from "./appoint-director.js";

describe("appoint-director payload", () => {
  it("names a workspace by slug and a member by username", () => {
    expect(appointDirectorPayload.parse({ workspaceSlug: "transports-ngwa", username: "awa" })).toEqual({
      workspaceSlug: "transports-ngwa",
      username: "awa",
    });
  });

  it("refuses tenant fields the operator has no business sending", () => {
    expect(
      appointDirectorPayload.safeParse({ workspaceSlug: "t", username: "awa", role: "DIRECTOR" }).success,
    ).toBe(false);
  });

  it("refuses an empty username", () => {
    expect(appointDirectorPayload.safeParse({ workspaceSlug: "t", username: "" }).success).toBe(false);
  });
});
