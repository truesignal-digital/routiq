import { describe, expect, it } from "vitest";
import {
  DASHBOARD_SERIES_DAYS_DEFAULT,
  dashboardQuery,
  dashboardResponse,
} from "./dashboard.js";

const series = [
  { date: "2026-07-24", expenseMinor: 50000, revenueMinor: 0 },
  { date: "2026-07-25", expenseMinor: 0, revenueMinor: 0 },
  { date: "2026-07-26", expenseMinor: 30000, revenueMinor: 420000 },
];

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
  series,
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
      series: [],
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

  it("keeps a zero-filled day rather than treating it as a gap", () => {
    const parsed = dashboardResponse.parse(response);
    expect(parsed.series).toEqual(series);
  });

  it("allows a series day to go negative — a reversal subtracts from its day", () => {
    const parsed = dashboardResponse.parse({
      ...response,
      series: [{ date: "2026-07-26", expenseMinor: -45000, revenueMinor: 0 }],
    });
    expect(parsed.series[0]?.expenseMinor).toBe(-45000);
  });

  it("rejects a series date that is a timestamp rather than a calendar day", () => {
    expect(
      dashboardResponse.safeParse({
        ...response,
        series: [
          {
            date: "2026-07-26T00:00:00Z",
            expenseMinor: 0,
            revenueMinor: 0,
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("dashboard query", () => {
  it("defaults the window to 90 days", () => {
    expect(dashboardQuery.parse({}).days).toBe(DASHBOARD_SERIES_DAYS_DEFAULT);
  });

  it("coerces the query-string number", () => {
    expect(dashboardQuery.parse({ days: "30" }).days).toBe(30);
  });

  it.each([6, 366, 0, -7, 30.5])("rejects days=%s", (days) => {
    expect(dashboardQuery.safeParse({ days }).success).toBe(false);
  });

  it("rejects a non-numeric window", () => {
    expect(dashboardQuery.safeParse({ days: "ninety" }).success).toBe(false);
  });
});
