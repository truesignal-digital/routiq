import { describe, expect, it } from "vitest";
import {
  assetAttentionStatuses,
  assetListItem,
  assetListResponse,
  assetOverview,
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

describe("asset availability contract", () => {
  it("keeps NOT_ASSESSED distinct from AVAILABLE", async () => {
    const { assetAvailability } = await import("./assets.js");
    expect(assetAvailability.parse({ state: "NOT_ASSESSED" })).toEqual({ state: "NOT_ASSESSED" });
    expect(assetAvailability.parse({ state: "AVAILABLE", since: null })).toEqual({
      state: "AVAILABLE",
      since: null,
    });
    expect(assetAvailability.safeParse({ state: "AVAILABLE" }).success).toBe(false);
    expect(assetAvailability.safeParse({ state: "UNKNOWN" }).success).toBe(false);
  });
});

describe("asset overview contract", () => {
  const assetId = "3f6b2a7c-9d41-4a52-8b0e-2c1d5e6f7a8b";
  const overview = {
    total: 8,
    canDrive: 5,
    grounded: { count: 2, first: { assetId, assetCode: "VH002", since: "2026-10-01T08:00:00.000Z" } },
    idle: { count: 4, days: 5, first: { assetId, assetCode: "VH004", lastTripAt: null } },
    notice: { today: "2026-10-09", schedule: "MONDAY_AND_MONTH_START", scheduledOn: "2026-10-05", scheduledToday: null, changes: [] },
  };

  it("accepts the counts, and null for a module that is off", () => {
    expect(assetOverview.parse(overview)).toEqual(overview);
    const off = { total: 3, canDrive: 3, grounded: null, idle: null, notice: overview.notice };
    expect(assetOverview.parse(off)).toEqual(off);
  });

  it("requires the summary notice (#667)", () => {
    const { notice: _notice, ...withoutNotice } = overview;
    expect(assetOverview.safeParse(withoutNotice).success).toBe(false);
  });

  it("accepts no first vehicle when none is grounded or idle", () => {
    const none = { ...overview, grounded: { count: 0, first: null }, idle: { count: 0, days: 5, first: null } };
    expect(assetOverview.parse(none)).toEqual(none);
  });

  it("refuses a missing tile, which must be null rather than absent", () => {
    expect(assetOverview.safeParse({ total: 3, canDrive: 3, grounded: null }).success).toBe(false);
    expect(assetOverview.safeParse({ ...overview, canDrive: -1 }).success).toBe(false);
  });
});
