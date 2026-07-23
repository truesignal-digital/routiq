import { describe, expect, it } from "vitest";
import {
  assetDisplayName,
  assetMatches,
  summarizeAssets,
  type AssetListItem,
} from "./model.js";

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

describe("asset list view model", () => {
  it("summarizes lifecycle state without conflating it with availability", () => {
    expect(summarizeAssets(assets)).toEqual({
      total: 2,
      inService: 1,
      attention: 1,
    });
  });

  it("searches bilingual labels and operational identifiers", () => {
    expect(assetMatches(assets[0]!, "camion", "ALL")).toBe(true);
    expect(assetMatches(assets[0]!, "LT 123", "ALL")).toBe(true);
    expect(assetMatches(assets[1]!, "yaoundé", "ATTENTION")).toBe(true);
    expect(assetMatches(assets[0]!, "douala", "ATTENTION")).toBe(false);
  });

  it("uses make and model when present, then falls back to asset code", () => {
    expect(assetDisplayName(assets[0]!)).toBe("Mercedes Actros");
    expect(assetDisplayName(assets[1]!)).toBe("BUS-004");
  });
});
