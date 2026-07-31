import { describe, expect, it } from "vitest";
import {
  assetAttentionStatuses,
  assetListItem,
  assetListResponse,
  assetSummary,
} from "./assets.js";

const item = {
  id: "3f6b2a7c-9d41-4a52-8b0e-2c1d5e6f7a8b",
  assetCode: "AST-001",
  registrationNumber: null,
  manufacturer: "Mercedes",
  model: "Actros",
  lifecycleStatus: "IN_SERVICE",
  rowVersion: 2,
  category: { code: "TRUCK", labelFr: "Camion", labelEn: "Truck" },
  branch: { code: "DLA", name: "Douala" },
};

describe("asset list contract", () => {
  it("accepts a row with the nullable identifiers unset", () => {
    expect(assetListItem.parse(item)).toEqual(item);
  });

  it("rejects a lifecycle status outside the enum", () => {
    expect(
      assetListItem.safeParse({ ...item, lifecycleStatus: "SCRAPPED" }).success,
    ).toBe(false);
  });

  it("wraps rows under `items`, not the finance legacy key", () => {
    expect(assetListResponse.parse({ items: [item], nextCursor: null })).toEqual({
      items: [item],
      nextCursor: null,
    });
    expect(
      assetListResponse.safeParse({ entries: [item], nextCursor: null }).success,
    ).toBe(false);
  });
});

describe("asset summary contract", () => {
  const summary = { total: 6, inService: 2, attention: 3 };

  it("accepts the three fleet buckets", () => {
    expect(assetSummary.parse(summary)).toEqual(summary);
  });

  it("accepts an empty fleet", () => {
    expect(assetSummary.parse({ total: 0, inService: 0, attention: 0 })).toEqual({
      total: 0,
      inService: 0,
      attention: 0,
    });
  });

  it("rejects counts that are not whole and non-negative", () => {
    expect(assetSummary.safeParse({ ...summary, total: -1 }).success).toBe(false);
    expect(assetSummary.safeParse({ ...summary, inService: 1.5 }).success).toBe(
      false,
    );
  });

  it("rejects a bucket left out — a missing tile must not read as zero", () => {
    expect(assetSummary.safeParse({ total: 6, inService: 2 }).success).toBe(false);
  });

  it("groups the same statuses the ATTENTION filter selects", () => {
    expect([...assetAttentionStatuses]).toEqual([
      "UNDER_MAINTENANCE",
      "RETIRED",
      "WRITTEN_OFF",
    ]);
  });
});
