import { describe, expect, it } from "vitest";
import { dashboardResponse } from "./dashboard.js";

const response = {
  assets: {
    total: 7,
    byStatus: {
      REGISTERED: 2,
      IN_SERVICE: 3,
      UNDER_MAINTENANCE: 1,
      SOLD: 1,
      RETIRED: 0,
      WRITTEN_OFF: 0,
    },
  },
  openPeriod: {
    periodCode: "2026-07",
    postedExpenseMinor: 150000,
    postedRevenueMinor: 420000,
    currency: "XAF",
  },
  pendingApprovals: { count: 4 },
};

describe("dashboard contract", () => {
  it("accepts a fully populated dashboard", () => {
    expect(dashboardResponse.parse(response)).toEqual(response);
  });

  it("accepts an empty workspace: zeros and no open period", () => {
    const empty = {
      assets: {
        total: 0,
        byStatus: {
          REGISTERED: 0,
          IN_SERVICE: 0,
          UNDER_MAINTENANCE: 0,
          SOLD: 0,
          RETIRED: 0,
          WRITTEN_OFF: 0,
        },
      },
      openPeriod: null,
      pendingApprovals: { count: 0 },
    };
    expect(dashboardResponse.parse(empty)).toEqual(empty);
  });

  it("requires every lifecycle status, so a zero can never arrive as a gap", () => {
    const { RETIRED: _dropped, ...partial } = response.assets.byStatus;
    expect(
      dashboardResponse.safeParse({
        ...response,
        assets: { ...response.assets, byStatus: partial },
      }).success,
    ).toBe(false);
  });

  it("rejects a status outside the lifecycle enum", () => {
    expect(
      dashboardResponse.safeParse({
        ...response,
        assets: {
          ...response.assets,
          byStatus: { ...response.assets.byStatus, SCRAPPED: 1 },
        },
      }).success,
    ).toBe(false);
  });

  it("allows a period total to go negative — reversals subtract", () => {
    const parsed = dashboardResponse.parse({
      ...response,
      openPeriod: { ...response.openPeriod, postedExpenseMinor: -45000 },
    });
    expect(parsed.openPeriod?.postedExpenseMinor).toBe(-45000);
  });

  it("rejects a currency that is not a 3-letter code", () => {
    expect(
      dashboardResponse.safeParse({
        ...response,
        openPeriod: { ...response.openPeriod, currency: "XA" },
      }).success,
    ).toBe(false);
  });
});
