import { describe, expect, it } from "vitest";
import { visibleFinanceSections } from "../finance/navigation.js";
import {
  canApproveEntries,
  canManagePeriods,
  canRecordFinance,
} from "../finance/permissions.js";
import { visibleSections } from "../shell/sections.js";

describe("finance navigation by role and module", () => {
  it("shows Finance, Record, and Entries to a FIELD_SUBMITTER", () => {
    const enabledModules = ["CORE", "FINANCE"] as const;

    expect(canRecordFinance("FIELD_SUBMITTER", enabledModules)).toBe(true);
    expect(canApproveEntries("FIELD_SUBMITTER", enabledModules)).toBe(false);
    expect(canManagePeriods("FIELD_SUBMITTER", enabledModules)).toBe(false);
    expect(visibleSections([...enabledModules]).map(({ key }) => key)).toContain(
      "finances",
    );
    expect(
      visibleFinanceSections("FIELD_SUBMITTER", enabledModules).map(
        ({ key }) => key,
      ),
    ).toEqual(["record", "entries"]);
  });

  it("shows all four finance screens to a FINANCE_APPROVER", () => {
    const enabledModules = ["CORE", "FINANCE"] as const;

    expect(canRecordFinance("FINANCE_APPROVER", enabledModules)).toBe(true);
    expect(canApproveEntries("FINANCE_APPROVER", enabledModules)).toBe(true);
    expect(canManagePeriods("FINANCE_APPROVER", enabledModules)).toBe(true);
    expect(visibleSections([...enabledModules]).map(({ key }) => key)).toContain(
      "finances",
    );
    expect(
      visibleFinanceSections("FINANCE_APPROVER", enabledModules).map(
        ({ key }) => key,
      ),
    ).toEqual(["record", "entries", "approvals", "periods"]);
  });

  it("hides Finance when the FINANCE module is disabled", () => {
    const enabledModules = ["CORE", "ASSETS"] as const;

    expect(canRecordFinance("FINANCE_APPROVER", enabledModules)).toBe(false);
    expect(canApproveEntries("FINANCE_APPROVER", enabledModules)).toBe(false);
    expect(canManagePeriods("FINANCE_APPROVER", enabledModules)).toBe(false);
    expect(visibleSections([...enabledModules]).map(({ key }) => key)).not.toContain(
      "finances",
    );
    expect(visibleFinanceSections("FINANCE_APPROVER", enabledModules)).toEqual([]);
  });
});
