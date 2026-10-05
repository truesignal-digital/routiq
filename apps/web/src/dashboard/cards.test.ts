import { describe, expect, it } from "vitest";
import type { ModuleCode, Role } from "@routiq/contracts";
import { canOpenEntriesList, visibleDashboardCards } from "./cards.js";

const ALL_MODULES: ModuleCode[] = ["CORE", "ASSETS", "FINANCE"];

describe("visibleDashboardCards (module gate)", () => {
  it("an approver with every module sees all four cards", () => {
    expect(visibleDashboardCards("FINANCE", ALL_MODULES)).toEqual([
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
    expect(visibleDashboardCards("DIRECTOR", ["CORE", "FINANCE"])).toEqual([
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
    for (const role of ["DIRECTOR", "FINANCE"] as const) {
      expect(visibleDashboardCards(role, ALL_MODULES)).toContain("pendingApprovals");
    }
    for (const role of ["ADMIN", "CASHIER", "TECHNICIAN", "DRIVER"] as const) {
      expect(visibleDashboardCards(role, ALL_MODULES)).not.toContain("pendingApprovals");
    }
  });

  it("keeps the period totals from the roles outside the ledger (#264)", () => {
    for (const role of ["CASHIER", "TECHNICIAN", "DRIVER"] as const) {
      expect(visibleDashboardCards(role, ALL_MODULES)).toEqual(["assets"]);
    }
  });

  it("the Administrateur keeps the period totals without the approvals queue", () => {
    expect(visibleDashboardCards("ADMIN", ALL_MODULES)).toEqual([
      "assets",
      "openPeriodExpense",
      "openPeriodRevenue",
    ]);
  });
});

describe("visibleDashboardCards (finance read gate, #59)", () => {
  it("a role the API refuses finance to sees no finance card, only its assets", () => {
    expect(visibleDashboardCards("TECHNICIAN", ALL_MODULES)).toEqual(["assets"]);
    expect(visibleDashboardCards("CASHIER", ALL_MODULES)).toEqual(["assets"]);
  });
});

describe("canOpenEntriesList", () => {
  it("matches the gate the entries screen itself applies", () => {
    const admitted: Role[] = ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER", "DRIVER"];
    for (const role of admitted) {
      expect(canOpenEntriesList(role, ALL_MODULES)).toBe(true);
    }
    expect(canOpenEntriesList("TECHNICIAN", ALL_MODULES)).toBe(false);
    expect(canOpenEntriesList("ADMIN", ["CORE", "ASSETS"])).toBe(false);
    expect(canOpenEntriesList(undefined, undefined)).toBe(false);
  });
});
