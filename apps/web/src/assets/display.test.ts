import type { AssetListItem } from "@routiq/contracts";
import { describe, expect, it } from "vitest";
import {
  ASSET_STATUS_TONES,
  assetDisplayName,
  assetFilterQuery,
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
  it("translates a filter choice into what the server is asked for", () => {
    expect(assetFilterQuery("ALL")).toEqual({});
    expect(assetFilterQuery("IN_SERVICE")).toEqual({ status: ["IN_SERVICE"] });
    // The tile's own set, grounding included, resolved on the server.
    expect(assetFilterQuery("ATTENTION")).toEqual({ attention: true });
  });

  it("uses make and model when present, then falls back to asset code", () => {
    expect(assetDisplayName(assets[0]!)).toBe("Mercedes Actros");
    expect(assetDisplayName(assets[1]!)).toBe("BUS-004");
  });

  it("tones every lifecycle status, and never conflates sold with written off", () => {
    expect(ASSET_STATUS_TONES.IN_SERVICE).toBe("success");
    expect(ASSET_STATUS_TONES.UNDER_MAINTENANCE).toBe("warning");
    expect(ASSET_STATUS_TONES.WRITTEN_OFF).toBe("danger");
    expect(ASSET_STATUS_TONES.SOLD).toBe("neutral");
    expect(Object.keys(ASSET_STATUS_TONES)).toHaveLength(6);
  });

  it("rejects a filter value the screen does not offer", () => {
    expect(isAssetFilter("ATTENTION")).toBe(true);
    expect(isAssetFilter("SOLD")).toBe(false);
  });
});
