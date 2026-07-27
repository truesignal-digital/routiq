import { describe, expect, it } from "vitest";
import type { ModuleCode, Role } from "@routiq/contracts";
import { canOpenEntriesList, visibleDashboardCards } from "./cards.js";

const ALL_MODULES: ModuleCode[] = ["CORE", "ASSETS", "FINANCE"];

describe("visibleDashboardCards (module gate)", () => {
  it("an approver with every module sees all four cards", () => {
    expect(visibleDashboardCards("FINANCE_APPROVER", ALL_MODULES)).toEqual([
      "pendingApprovals",
      "assets",
      "openPeriodExpense",
      "openPeriodRevenue",
    ]);
  });

  it("a disabled finance module removes every finance card", () => {
    expect(visibleDashboardCards("ADMIN", ["CORE", "ASSETS"])).toEqual(["assets"]);
  });

  it("a disabled assets module removes the assets card", () => {
    expect(visibleDashboardCards("ADMIN", ["CORE", "FINANCE"])).toEqual([
      "pendingApprovals",
      "openPeriodExpense",
      "openPeriodRevenue",
    ]);
  });

  it("renders nothing while membership is still loading", () => {
    expect(visibleDashboardCards(undefined, undefined)).toEqual([]);
  });
});

describe("visibleDashboardCards (role gate)", () => {
  it("only approver roles get the approvals card", () => {
    for (const role of ["FINANCE_APPROVER", "ADMIN"] as const) {
      expect(visibleDashboardCards(role, ALL_MODULES)).toContain("pendingApprovals");
    }
    for (const role of ["FIELD_SUBMITTER", "OPS_MANAGER", "EXECUTIVE_VIEWER"] as const) {
      expect(visibleDashboardCards(role, ALL_MODULES)).not.toContain("pendingApprovals");
    }
  });

  it("a non-approver still sees the period totals", () => {
    expect(visibleDashboardCards("FIELD_SUBMITTER", ALL_MODULES)).toEqual([
      "assets",
      "openPeriodExpense",
      "openPeriodRevenue",
    ]);
  });

  it("a read-only executive keeps the numbers the role exists to read", () => {
    expect(visibleDashboardCards("EXECUTIVE_VIEWER", ALL_MODULES)).toEqual([
      "assets",
      "openPeriodExpense",
      "openPeriodRevenue",
    ]);
  });
});

describe("canOpenEntriesList", () => {
  it("matches the gate the entries screen itself applies", () => {
    const admitted: Role[] = ["ADMIN", "OPS_MANAGER", "FINANCE_APPROVER", "FIELD_SUBMITTER"];
    for (const role of admitted) {
      expect(canOpenEntriesList(role, ALL_MODULES)).toBe(true);
    }
    expect(canOpenEntriesList("EXECUTIVE_VIEWER", ALL_MODULES)).toBe(false);
    expect(canOpenEntriesList("ADMIN", ["CORE", "ASSETS"])).toBe(false);
    expect(canOpenEntriesList(undefined, undefined)).toBe(false);
  });
});
