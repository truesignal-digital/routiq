import { describe, expect, it } from "vitest";
import {
  canApproveEntries,
  canManagePeriods,
  canRecordFinance,
} from "../finance/permissions.js";
import { visibleSections } from "../shell/sections.js";

describe("finance navigation by role and module", () => {
  it("shows Money to a DRIVER, with no decisions or months", () => {
    const enabledModules = ["CORE", "FINANCE"] as const;

    expect(canRecordFinance("DRIVER", enabledModules)).toBe(true);
    expect(canApproveEntries("DRIVER", enabledModules)).toBe(false);
    expect(canManagePeriods("DRIVER", enabledModules)).toBe(false);
    expect(visibleSections([...enabledModules]).map(({ key }) => key)).toContain(
      "finances",
    );
  });

  it("shows Money, decisions and Accounting months to a FINANCE", () => {
    const enabledModules = ["CORE", "FINANCE"] as const;

    expect(canRecordFinance("FINANCE", enabledModules)).toBe(true);
    expect(canApproveEntries("FINANCE", enabledModules)).toBe(true);
    expect(canManagePeriods("FINANCE", enabledModules)).toBe(true);
    expect(visibleSections([...enabledModules]).map(({ key }) => key)).toContain(
      "finances",
    );
  });

  it("hides Finance when the FINANCE module is disabled", () => {
    const enabledModules = ["CORE", "ASSETS"] as const;

    expect(canRecordFinance("FINANCE", enabledModules)).toBe(false);
    expect(canApproveEntries("FINANCE", enabledModules)).toBe(false);
    expect(canManagePeriods("FINANCE", enabledModules)).toBe(false);
    expect(visibleSections([...enabledModules]).map(({ key }) => key)).not.toContain(
      "finances",
    );
  });
});
