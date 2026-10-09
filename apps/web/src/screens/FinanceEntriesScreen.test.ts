import { describe, expect, it } from "vitest";
import {
  canApproveEntries,
  canManagePeriods,
  canRecordFinance,
} from "../finance/permissions.js";
import { visibleSections } from "../shell/sections.js";

describe("finance navigation by role and module", () => {
  it("gives a DRIVER no Money row, decisions or months: their own entries show on their truck and trips", () => {
    const enabledModules = ["CORE", "FINANCE"] as const;

    expect(canRecordFinance("DRIVER", enabledModules)).toBe(true);
    expect(canApproveEntries("DRIVER", enabledModules)).toBe(false);
    expect(canManagePeriods("DRIVER", enabledModules)).toBe(false);
    expect(visibleSections("DRIVER", [...enabledModules]).map(({ key }) => key)).not.toContain(
      "finances",
    );
  });

  it("shows Money, decisions and Accounting months to a FINANCE", () => {
    const enabledModules = ["CORE", "FINANCE"] as const;

    expect(canRecordFinance("FINANCE", enabledModules)).toBe(true);
    expect(canApproveEntries("FINANCE", enabledModules)).toBe(true);
    expect(canManagePeriods("FINANCE", enabledModules)).toBe(true);
    expect(visibleSections("FINANCE", [...enabledModules]).map(({ key }) => key)).toContain(
      "finances",
    );
  });

  it("hides Money when the FINANCE module is disabled", () => {
    const enabledModules = ["CORE", "ASSETS"] as const;

    expect(canRecordFinance("FINANCE", enabledModules)).toBe(false);
    expect(canApproveEntries("FINANCE", enabledModules)).toBe(false);
    expect(canManagePeriods("FINANCE", enabledModules)).toBe(false);
    expect(visibleSections("FINANCE", [...enabledModules]).map(({ key }) => key)).not.toContain(
      "finances",
    );
  });
});
