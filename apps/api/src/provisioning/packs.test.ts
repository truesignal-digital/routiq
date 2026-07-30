import { describe, expect, it } from "vitest";
import { defaultApprovalRules } from "../commands/approval-defaults.js";
import { presetCategories } from "../commands/category-presets.js";
import { corePack } from "./packs/core.js";
import { passengerTransportPack } from "./packs/passenger-transport.js";
import { truckingPack } from "./packs/trucking.js";

const categoryKey = (category: { kind: string; code: string }): string =>
  `${category.kind}:${category.code}`;

describe("starter packs", () => {
  it("partitions every preset category without loss or duplication", () => {
    const workspaceId = "00000000-0000-0000-0000-000000000001";
    const packCategories = [
      ...corePack.categories,
      ...truckingPack.categories,
      ...passengerTransportPack.categories,
    ];
    const packKeys = packCategories.map(categoryKey);

    expect(new Set(packKeys).size).toBe(packCategories.length);
    expect(packKeys.sort()).toEqual([
      "ACTIVITY_TYPE:CHARTER",
      "ACTIVITY_TYPE:HAULAGE_JOB",
      "ACTIVITY_TYPE:SCHEDULED_JOURNEY",
      "ASSET_CLASS:BUS",
      "ASSET_CLASS:TRAILER",
      "ASSET_CLASS:TRUCK",
      "ASSET_CLASS:VAN",
      "DOCUMENT_TYPE:INSURANCE",
      "DOCUMENT_TYPE:PERMIT",
      "EXPENSE_CATEGORY:CREW_ALLOWANCE",
      "EXPENSE_CATEGORY:DRIVER_ALLOWANCE",
      "EXPENSE_CATEGORY:FUEL",
      "EXPENSE_CATEGORY:INSURANCE",
      "EXPENSE_CATEGORY:LOADING",
      "EXPENSE_CATEGORY:PARKING",
      "EXPENSE_CATEGORY:REPAIRS",
      "EXPENSE_CATEGORY:TOLLS",
      "REVENUE_CATEGORY:FREIGHT_REVENUE",
      "REVENUE_CATEGORY:TICKET_REVENUE",
    ]);
    expect(
      packCategories.map((category) => ({ ...category, workspaceId })),
    ).toEqual(presetCategories(workspaceId));
  });

  it("keeps every default approval rule in the core pack", () => {
    const workspaceId = "00000000-0000-0000-0000-000000000001";

    expect(corePack.approvalRules.length).toBeGreaterThan(0);
    expect(corePack.approvalRules.every((rule) => !("workspaceId" in rule))).toBe(true);
    expect(defaultApprovalRules(workspaceId)).toEqual(
      corePack.approvalRules.map((rule) => ({ ...rule, workspaceId })),
    );
  });
});
