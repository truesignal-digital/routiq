import { describe, expect, it } from "vitest";
import { MONEY_OVERVIEW_READER_ROLES } from "../roles.js";
import { financeOverviewQuery, financeOverviewResponse, type FinanceOverviewResponse } from "./finance-overview.js";

const window = (profitMinor: number | null) => ({
  from: "2026-10-01",
  to: "2026-10-09",
  revenueMinor: 900_000,
  expenseMinor: 700_000,
  profitMinor,
});

const companyProfit = {
  vehicleProfitMinor: 250_000,
  revenueWithoutVehicleMinor: 0,
  companyCostsMinor: 50_000,
  companyProfitMinor: 200_000,
};

const summary: FinanceOverviewResponse["summary"] = {
  template: "BEHIND",
  measure: "PROFIT",
  window: "MONTH_SO_FAR",
  period: { from: "2026-10-01", to: "2026-10-09" },
  comparison: { from: "2026-09-01", to: "2026-09-09" },
  currentMinor: 200_000,
  comparisonMinor: 300_000,
  revenueMinor: 900_000,
  changePercent: 33,
  reason: { kind: "CATEGORY", category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" }, changeMinor: 100_000 },
  shortOf: null,
  trips: { closed: 4, open: 1 },
};

const notice: FinanceOverviewResponse["notice"] = {
  today: "2026-10-09",
  schedule: "MONDAY_AND_MONTH_START",
  scheduledOn: "2026-10-05",
  scheduledToday: null,
  changes: [
    {
      kind: "VEHICLE_GROUNDED",
      key: "VEHICLE_GROUNDED:7d1c0f0e-8a43-4f3c-9d0e-0a7f3c1b2d4e",
      assetId: "3f0b4c2a-1d5e-4f6a-8b7c-9d0e1f2a3b4c",
      assetCode: "VH003",
      since: "2026-10-07T08:00:00.000Z",
    },
    { kind: "EXPENSES_UP", key: "EXPENSES_UP:2026-10-01", expenseMinor: 700_000, comparisonExpenseMinor: 500_000, percent: 40 },
  ],
};

const ledgerBody: FinanceOverviewResponse = {
  currency: "XAF",
  range: "THIS_MONTH",
  branchId: null,
  view: "PROFIT",
  period: window(200_000),
  comparison: window(200_000),
  series: Array.from({ length: 12 }, (_, i) => ({
    periodCode: `2026-${String((i % 9) + 1).padStart(2, "0")}`,
    revenueMinor: 0,
    expenseMinor: 0,
  })),
  expensesByCategory: [],
  vehicles: [],
  branches: [],
  companyProfit: { period: companyProfit, comparison: companyProfit },
  counted: { postedEntries: 0, closedTrips: 0 },
  notCounted: {
    waitingApproval: { count: 0, amountMinor: 0 },
    missingReceipt: { count: 0, amountMinor: 0 },
    openTrips: 0,
    otherCurrencyEntries: 0,
  },
  summary,
  notice,
};

const cashierBody: FinanceOverviewResponse = {
  ...ledgerBody,
  view: "REVENUE_AND_EXPENSES",
  period: window(null),
  comparison: window(null),
  vehicles: null,
  branches: null,
  companyProfit: null,
  summary: { ...summary, measure: "EXPENSES", revenueMinor: null, currentMinor: 700_000, comparisonMinor: 500_000 },
};

describe("financeOverviewQuery", () => {
  it("defaults to this month, all the caller's branches", () => {
    expect(financeOverviewQuery.parse({})).toEqual({ range: "THIS_MONTH" });
  });

  it("takes the three ranges and nothing else", () => {
    for (const range of ["THIS_MONTH", "THREE_MONTHS", "TWELVE_MONTHS"]) {
      expect(financeOverviewQuery.safeParse({ range }).success).toBe(true);
    }
    expect(financeOverviewQuery.safeParse({ range: "WEEK" }).success).toBe(false);
    expect(financeOverviewQuery.safeParse({ branchId: "DLA" }).success).toBe(false);
  });
});

describe("financeOverviewResponse", () => {
  it("parses the ledger view and the cashier view", () => {
    expect(financeOverviewResponse.parse(ledgerBody)).toEqual(ledgerBody);
    expect(financeOverviewResponse.parse(cashierBody)).toEqual(cashierBody);
  });

  it("refuses any profit figure in the cashier's view", () => {
    for (const leak of [
      { period: window(200_000) },
      { comparison: window(200_000) },
      { companyProfit: ledgerBody.companyProfit },
      { vehicles: [] },
      { branches: [] },
      { summary },
    ]) {
      expect(financeOverviewResponse.safeParse({ ...cashierBody, ...leak }).success, JSON.stringify(leak)).toBe(false);
    }
  });

  it("refuses a ledger view that drops profit", () => {
    expect(financeOverviewResponse.safeParse({ ...ledgerBody, period: window(null) }).success).toBe(false);
    expect(financeOverviewResponse.safeParse({ ...ledgerBody, companyProfit: null }).success).toBe(false);
  });

  it("has exactly 12 months in the chart", () => {
    expect(financeOverviewResponse.safeParse({ ...ledgerBody, series: ledgerBody.series.slice(1) }).success).toBe(false);
  });

  it("carries money as whole minor units", () => {
    expect(financeOverviewResponse.safeParse({ ...ledgerBody, period: { ...window(200_000), revenueMinor: 900_000.5 } }).success).toBe(false);
  });
});

describe("the summary notice (#667)", () => {
  it("takes the five templates and nothing else", () => {
    for (const template of ["AHEAD", "BEHIND", "FLAT", "NOT_ENOUGH_DATA", "FIRST_MONTH"]) {
      expect(financeOverviewResponse.safeParse({ ...ledgerBody, summary: { ...summary, template } }).success, template).toBe(true);
    }
    expect(financeOverviewResponse.safeParse({ ...ledgerBody, summary: { ...summary, template: "GREAT" } }).success).toBe(false);
  });

  it("takes only the two scheduled reasons and the two kinds of change", () => {
    expect(financeOverviewResponse.safeParse({ ...ledgerBody, notice: { ...notice, scheduledToday: "MONDAY" } }).success).toBe(true);
    expect(financeOverviewResponse.safeParse({ ...ledgerBody, notice: { ...notice, scheduledToday: "FRIDAY" } }).success).toBe(false);
    expect(
      financeOverviewResponse.safeParse({ ...ledgerBody, notice: { ...notice, changes: [{ kind: "PRICE_UP", key: "x" }] } }).success,
    ).toBe(false);
  });
});

describe("MONEY_OVERVIEW_READER_ROLES", () => {
  it("is the ledger readers and the cashier", () => {
    expect([...MONEY_OVERVIEW_READER_ROLES].sort()).toEqual(["ADMIN", "CASHIER", "DIRECTOR", "FINANCE"]);
  });
});
