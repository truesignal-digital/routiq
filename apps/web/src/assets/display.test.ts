import type { AssetListItem } from "@routiq/contracts";
import { describe, expect, it } from "vitest";
import {
  assetDisplayName,
  assetFilterStatuses,
  isAssetFilter,
} from "./display.js";

const assets: AssetListItem[] = [
  {
    id: "asset-1",
    assetCode: "TRK-001",
    registrationNumber: "LT 123 AB",
    manufacturer: "Mercedes",
    model: "Actros",
    lifecycleStatus: "IN_SERVICE",
    rowVersion: 2,
    category: { code: "TRUCK", labelFr: "Camion", labelEn: "Truck" },
    branch: { code: "DLA", name: "Douala" },
  },
  {
    id: "asset-2",
    assetCode: "BUS-004",
    registrationNumber: null,
    manufacturer: null,
    model: null,
    lifecycleStatus: "UNDER_MAINTENANCE",
    rowVersion: 1,
    category: { code: "BUS", labelFr: "Autobus", labelEn: "Bus" },
    branch: { code: "YDE", name: "Yaoundé" },
  },
];

describe("asset display helpers", () => {
  it("translates a filter choice into the statuses the server is asked for", () => {
    expect(assetFilterStatuses("ALL")).toBeUndefined();
    expect(assetFilterStatuses("IN_SERVICE")).toEqual(["IN_SERVICE"]);
    expect(assetFilterStatuses("ATTENTION")).toEqual([
      "UNDER_MAINTENANCE",
      "RETIRED",
      "WRITTEN_OFF",
    ]);
  });

  it("uses make and model when present, then falls back to asset code", () => {
    expect(assetDisplayName(assets[0]!)).toBe("Mercedes Actros");
    expect(assetDisplayName(assets[1]!)).toBe("BUS-004");
  });

  it("rejects a filter value the screen does not offer", () => {
    expect(isAssetFilter("ATTENTION")).toBe(true);
    expect(isAssetFilter("SOLD")).toBe(false);
  });
});
