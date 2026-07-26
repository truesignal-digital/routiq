import { describe, expect, it } from "vitest";
import { assetListItem, assetListResponse } from "./assets.js";

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
