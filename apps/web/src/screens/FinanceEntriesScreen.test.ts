import { describe, expect, it } from "vitest";
import { visibleFinanceSections } from "../finance/navigation.js";
import {
  canApproveEntries,
  canManagePeriods,
  canRecordFinance,
} from "../finance/permissions.js";
import { visibleSections } from "../shell/sections.js";

describe("finance navigation by role and module", () => {
  it("shows Finance and the Entries tab to a DRIVER", () => {
    const enabledModules = ["CORE", "FINANCE"] as const;

    expect(canRecordFinance("DRIVER", enabledModules)).toBe(true);
    expect(canApproveEntries("DRIVER", enabledModules)).toBe(false);
    expect(canManagePeriods("DRIVER", enabledModules)).toBe(false);
    expect(visibleSections([...enabledModules]).map(({ key }) => key)).toContain(
      "finances",
    );
    expect(
      visibleFinanceSections("DRIVER", enabledModules).map(
        ({ key }) => key,
      ),
    ).toEqual(["entries"]);
  });

  it("shows all three finance tabs to a FINANCE", () => {
    const enabledModules = ["CORE", "FINANCE"] as const;

    expect(canRecordFinance("FINANCE", enabledModules)).toBe(true);
    expect(canApproveEntries("FINANCE", enabledModules)).toBe(true);
    expect(canManagePeriods("FINANCE", enabledModules)).toBe(true);
    expect(visibleSections([...enabledModules]).map(({ key }) => key)).toContain(
      "finances",
    );
    expect(
      visibleFinanceSections("FINANCE", enabledModules).map(
        ({ key }) => key,
      ),
    ).toEqual(["entries", "approvals", "periods"]);
  });

  it("hides Finance when the FINANCE module is disabled", () => {
    const enabledModules = ["CORE", "ASSETS"] as const;

    expect(canRecordFinance("FINANCE", enabledModules)).toBe(false);
    expect(canApproveEntries("FINANCE", enabledModules)).toBe(false);
    expect(canManagePeriods("FINANCE", enabledModules)).toBe(false);
    expect(visibleSections([...enabledModules]).map(({ key }) => key)).not.toContain(
      "finances",
    );
    expect(visibleFinanceSections("FINANCE", enabledModules)).toEqual([]);
  });
});
