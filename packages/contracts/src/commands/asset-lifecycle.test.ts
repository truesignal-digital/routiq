import { describe, expect, it } from "vitest";
import { assignAssetPayload } from "./asset-lifecycle.js";

const assetId = "3f6b2a7c-9d41-4a52-8b0e-2c1d5e6f7a8b";
const membershipId = "0b8a4c1e-6f2d-4e3a-9c5b-7d1e2f3a4b5c";

describe("assignAssetPayload", () => {
  it("accepts a custodian, a branch, or both", () => {
    expect(assignAssetPayload.safeParse({ assetId, custodianMembershipId: membershipId }).success).toBe(true);
    expect(assignAssetPayload.safeParse({ assetId, branchCode: "DLA" }).success).toBe(true);
    expect(
      assignAssetPayload.safeParse({ assetId, branchCode: "DLA", custodianMembershipId: membershipId })
        .success,
    ).toBe(true);
  });

  it("treats null as clearing the custodian — a target, not an absence", () => {
    expect(assignAssetPayload.parse({ assetId, custodianMembershipId: null })).toEqual({
      assetId,
      custodianMembershipId: null,
    });
  });

  it("still refuses an assignment that names nothing", () => {
    expect(assignAssetPayload.safeParse({ assetId }).success).toBe(false);
  });
});
