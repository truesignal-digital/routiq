// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  fetchFleetUsage,
  fleetUsageQueryOptions,
  isFleetUsageResponse,
  onTheRoadShare,
  pointsChange,
  wholeShare,
} from "./useFleetUsage.js";

const days = { tripDays: 0, recordedDays: 0, notRecordedDays: 30 };
const body = {
  range: "THIS_MONTH",
  branchId: null,
  businessDate: "2026-10-09",
  period: { from: "2026-10-01", to: "2026-10-09" },
  comparison: { from: "2026-09-01", to: "2026-09-09" },
  kmRule: "LEGS_THEN_ODOMETER",
  boardDays: [],
  vehicles: [{ assetId: "a1", assetCode: "VH001", registrationNumber: null, branchId: "b", days: [], period: null, comparison: null, money: null }],
  km: null,
  onTheRoad: { last: days, previous: days },
  offRoadByMonth: null,
  money: null,
  trips: null,
};

describe("fleet usage read (#668)", () => {
  it("asks for the range and the shell's branch", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body)));
    await fetchFleetUsage("token", "THREE_MONTHS", "b1", undefined, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("/v1/assets/usage?range=THREE_MONTHS&branchId=b1", {
      headers: { authorization: "Bearer token" },
    });
  });

  it("refuses a body that is not the usage read", async () => {
    expect(isFleetUsageResponse(body)).toBe(true);
    expect(isFleetUsageResponse({ ...body, onTheRoad: { last: days } })).toBe(false);
    expect(isFleetUsageResponse({ ...body, vehicles: [{ assetId: "a1" }] })).toBe(false);
    expect(isFleetUsageResponse({ ...body, trips: { routes: "none" } })).toBe(false);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ range: "THIS_MONTH" })));
    await expect(fetchFleetUsage("token", "THIS_MONTH", undefined, undefined, fetchImpl)).rejects.toThrow("FLEET_USAGE_SHAPE");
  });

  it("names the status when the server refuses", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 403 }));
    await expect(fetchFleetUsage("token", "THIS_MONTH", undefined, undefined, fetchImpl)).rejects.toThrow("FLEET_USAGE_403");
  });

  it("keys the read under the workspace's assets, by range and branch", () => {
    expect(fleetUsageQueryOptions("ws-1", "THIS_MONTH", undefined).queryKey).toEqual(["ws", "ws-1", "assets", "usage", "THIS_MONTH", "ALL"]);
    expect(fleetUsageQueryOptions("ws-1", "TWELVE_MONTHS", "b1").queryKey).toEqual(["ws", "ws-1", "assets", "usage", "TWELVE_MONTHS", "b1"]);
  });
});

describe("usage figures", () => {
  it("never turns a missing base into 0", () => {
    expect(wholeShare(3, 0)).toBeNull();
    expect(wholeShare(1, 3)).toBe(33);
    expect(onTheRoadShare({ tripDays: 19, recordedDays: 30, notRecordedDays: 0 })).toBe(63);
    expect(onTheRoadShare(days)).toBeNull();
  });

  it("compares two percents in points, and says nothing when one is not known", () => {
    expect(pointsChange(63, 67)).toEqual({ kind: "moved", arrow: "▼", points: 4 });
    expect(pointsChange(18, 15)).toEqual({ kind: "moved", arrow: "▲", points: 3 });
    expect(pointsChange(40, 40)).toEqual({ kind: "same" });
    expect(pointsChange(null, 40)).toBeNull();
  });
});
