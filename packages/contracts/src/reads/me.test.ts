import { describe, expect, it } from "vitest";
import { meResponse } from "./me.js";

const me = {
  workspaceId: "6f1c2b8e-3a4d-4e5f-8a9b-0c1d2e3f4a5b",
  principalId: "7a2d3c9f-4b5e-4f60-9b0c-1d2e3f4a5b6c",
  principalType: "HUMAN",
  membershipId: "8b3e4d0a-5c6f-4071-8c1d-2e3f4a5b6c7d",
  role: "DRIVER",
  branchScope: ["9c4f5e1b-6d70-4182-9d2e-3f4a5b6c7d8e"],
  displayName: "Sali Ahmadou",
  workspaceName: "Transports Ngwa",
  timezone: "Africa/Douala",
  enabledModules: ["CORE", "ASSETS"],
  enabledPresets: ["TRUCKING"],
};

describe("meResponse", () => {
  it("accepts the member's name and the workspace's name", () => {
    expect(meResponse.parse(me)).toEqual(me);
  });

  it("requires both names", () => {
    const { displayName: _name, ...withoutName } = me;
    const { workspaceName: _workspace, ...withoutWorkspace } = me;
    expect(meResponse.safeParse(withoutName).success).toBe(false);
    expect(meResponse.safeParse(withoutWorkspace).success).toBe(false);
    expect(meResponse.safeParse({ ...me, displayName: "" }).success).toBe(false);
  });

  // #639: the web cuts "today" at the workspace's midnight, so it needs the zone.
  it("requires the workspace's time zone", () => {
    const { timezone: _timezone, ...withoutZone } = me;
    expect(meResponse.safeParse(withoutZone).success).toBe(false);
  });

  it("accepts a whole-workspace scope", () => {
    expect(meResponse.safeParse({ ...me, branchScope: "ALL" }).success).toBe(true);
  });
});
