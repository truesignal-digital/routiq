// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fetchMoneyOverview, isMoneyOverview } from "./useMoneyOverview.js";

const window = { from: "2026-10-01", to: "2026-10-09", revenueMinor: 0, expenseMinor: 0, profitMinor: null };
const body = {
  currency: "XAF",
  range: "THIS_MONTH",
  branchId: null,
  view: "REVENUE_AND_EXPENSES",
  period: window,
  comparison: window,
  series: [],
  expensesByCategory: [],
  vehicles: null,
  branches: null,
  companyProfit: null,
  counted: { postedEntries: 0, closedTrips: null },
  notCounted: {
    waitingApproval: { count: 0, amountMinor: 0 },
    missingReceipt: { count: 0, amountMinor: 0 },
    openTrips: null,
    otherCurrencyEntries: 0,
  },
};

describe("money overview read (#664)", () => {
  it("asks for the range and the shell's branch", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body)));
    await fetchMoneyOverview("token", "THREE_MONTHS", "b1", undefined, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("/v1/finance/overview?range=THREE_MONTHS&branchId=b1", {
      headers: { authorization: "Bearer token" },
    });
  });

  it("refuses a body that is not the overview", async () => {
    expect(isMoneyOverview(body)).toBe(true);
    expect(isMoneyOverview({ ...body, view: "EVERYTHING" })).toBe(false);
    expect(isMoneyOverview({ ...body, period: { from: "2026-10-01" } })).toBe(false);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ currency: "XAF" })));
    await expect(fetchMoneyOverview("token", "THIS_MONTH", undefined, undefined, fetchImpl)).rejects.toThrow(
      "FINANCE_OVERVIEW_SHAPE",
    );
  });

  it("names the status when the server refuses", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 403 }));
    await expect(fetchMoneyOverview("token", "THIS_MONTH", undefined, undefined, fetchImpl)).rejects.toThrow(
      "FINANCE_OVERVIEW_403",
    );
  });
});
