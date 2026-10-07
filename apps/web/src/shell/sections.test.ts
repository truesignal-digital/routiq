import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  Banknote,
  Building,
  Calendar,
  House,
  Menu,
  Route,
  ShieldUser,
  SlidersHorizontal,
  Truck,
  UserRound,
  Wrench,
} from "lucide-react";
import { ROLES, type ModuleCode, type Role } from "@routiq/contracts";
import { canReadFinanceEntries, canRecordFinance } from "../finance/permissions.js";
import {
  activeSection,
  isSectionActive,
  visibleSectionGroups,
  visibleSections,
} from "./sections.js";

const EVERY: ModuleCode[] = ["CORE", "ASSETS", "ACTIVITIES", "MAINTENANCE", "FINANCE", "DOCUMENTS"];
const ALL = visibleSections("DIRECTOR", EVERY);

function activeKey(pathname: string): string | undefined {
  return activeSection(ALL, pathname)?.key;
}

/** Rows per group, by key; `more` is the personal page #316 removes. */
function sidebar(role: Role, modules: ModuleCode[] = EVERY) {
  return Object.fromEntries(
    visibleSectionGroups(role, modules).map((group) => [
      group.key,
      group.sections.map((section) => section.key).filter((key) => key !== "more"),
    ]),
  );
}

describe("each role's sidebar (#312)", () => {
  // The table in #312, module gates on top.
  const expected: Record<Role, Record<string, string[]>> = {
    DIRECTOR: {
      daily: ["home", "assets", "activities", "maintenance", "finances"],
      company: ["persons", "users", "branches", "accountingMonths", "companySettings"],
    },
    ADMIN: {
      daily: ["home", "assets", "activities", "maintenance", "finances"],
      company: ["persons", "users"],
    },
    FINANCE: { daily: ["home", "assets", "activities", "finances"], company: ["persons", "accountingMonths"] },
    CASHIER: { daily: ["home", "assets", "finances"] },
    TECHNICIAN: { daily: ["home", "assets", "maintenance"] },
    DRIVER: { daily: ["home", "assets", "activities"] },
  };

  it.each(ROLES)("%s", (role) => {
    expect(sidebar(role)).toEqual(expected[role]);
  });

  it("drops Money for everyone when Finance is off", () => {
    for (const role of ROLES) {
      const modules = EVERY.filter((code) => code !== "FINANCE");
      expect(sidebar(role, modules).daily, role).not.toContain("finances");
    }
  });

  it("drops Company settings with Finance off: the approval chain is its only section (#354)", () => {
    const modules = EVERY.filter((code) => code !== "FINANCE");
    expect(sidebar("DIRECTOR", modules).company).not.toContain("companySettings");
  });

  it("drops Accounting months for everyone when Finance is off (#314)", () => {
    for (const role of ROLES) {
      const modules = EVERY.filter((code) => code !== "FINANCE");
      expect(sidebar(role, modules).company ?? [], role).not.toContain("accountingMonths");
    }
  });

  it("keeps one row per page: no Approvals row, and Accounting months is the only periods row (#314)", () => {
    const rows = visibleSections("DIRECTOR", EVERY);
    expect(rows.filter((row) => row.to.startsWith("/finance/approvals"))).toEqual([]);
    expect(rows.filter((row) => row.to === "/finance/periods").map((row) => row.key)).toEqual(["accountingMonths"]);
  });

  it("drops Maintenance for everyone when Maintenance is off", () => {
    for (const role of ROLES) {
      const modules = EVERY.filter((code) => code !== "MAINTENANCE");
      expect(sidebar(role, modules).daily, role).not.toContain("maintenance");
    }
  });

  it("leaves out a group with no rows rather than showing an empty heading", () => {
    expect(visibleSectionGroups("DRIVER", EVERY).map((group) => group.key)).toEqual(["daily"]);
  });

  it("shows Money only where it never leads to a denial (#64)", () => {
    for (const role of ROLES) {
      if (!visibleSections(role, EVERY).some((section) => section.key === "finances")) continue;
      expect(canReadFinanceEntries(role, EVERY), role).toBe(true);
    }
  });

  it("gives every role that records money a way to read it back", () => {
    for (const role of ROLES) {
      if (!canRecordFinance(role, EVERY)) continue;
      expect(canReadFinanceEntries(role, EVERY), role).toBe(true);
    }
  });

  it("while membership is loading shows only rows no module or role decides", () => {
    expect(visibleSections(undefined, undefined).map((s) => s.key)).toEqual(["home", "more"]);
  });

  it("home leads the nav for every role and module combination", () => {
    for (const role of ROLES) {
      for (const modules of [["CORE"], ["CORE", "ASSETS"], EVERY] as ModuleCode[][]) {
        expect(visibleSections(role, modules)[0]?.key).toBe("home");
      }
    }
  });
});

describe("row label = page title (#312)", () => {
  // The screen each row opens, and the source that renders its PageHeader.
  const SCREENS: Record<string, string> = {
    home: "screens/DashboardScreen.tsx",
    assets: "screens/AssetsStub.tsx",
    activities: "screens/ActivitiesScreen.tsx",
    maintenance: "screens/MaintenanceScreen.tsx",
    finances: "screens/FinanceEntriesScreen.tsx",
    more: "screens/MoreStub.tsx",
    persons: "screens/PersonsScreen.tsx",
    users: "screens/UsersScreen.tsx",
    branches: "screens/BranchesScreen.tsx",
    accountingMonths: "screens/FinancePeriodsScreen.tsx",
    companySettings: "screens/CompanySettingsScreen.tsx",
  };

  it.each(ALL.map((section) => [section.key, section] as const))("%s", (key, section) => {
    const screen = SCREENS[key];
    expect(screen, `${key} needs an entry in SCREENS`).toBeDefined();
    const source = readFileSync(join(import.meta.dirname, "..", screen ?? ""), "utf8");
    expect(source).toContain(`title={t("${section.labelKey}")}`);
  });
});

describe("isSectionActive (exact-or-child)", () => {
  it("matches the section's own route", () => {
    expect(activeKey("/assets")).toBe("assets");
    expect(activeKey("/maintenance")).toBe("maintenance");
    expect(activeKey("/more")).toBe("more");
  });

  it("home owns the landing route only, never every route beneath it", () => {
    expect(activeKey("/")).toBe("home");
    expect(activeKey("/assets")).toBe("assets");
    expect(activeKey("/finance/entries")).toBe("finances");
  });

  it("matches child routes", () => {
    expect(activeKey("/assets/new")).toBe("assets");
    expect(activeKey("/assets/abc-123/documents")).toBe("assets");
  });

  it("a section owning a subtree stays active across its siblings", () => {
    expect(activeKey("/finance/entries")).toBe("finances");
    expect(activeKey("/finance/record")).toBe("finances");
    expect(activeKey("/finance/approvals")).toBe("finances");
  });

  it("Accounting months owns its page, not the Money subtree it sits in (#314)", () => {
    expect(activeKey("/finance/periods")).toBe("accountingMonths");
    expect(activeSection(visibleSections("CASHIER", EVERY), "/finance/periods")?.key).toBe("finances");
  });

  it("a Company row owns its page, not the More page it sits under", () => {
    expect(activeKey("/more/persons")).toBe("persons");
    expect(activeKey("/more/users")).toBe("users");
    expect(activeKey("/more/branches")).toBe("branches");
  });

  it("never matches a route that merely shares a string prefix", () => {
    expect(activeKey("/assets-archive")).toBeUndefined();
    expect(activeKey("/financements")).toBeUndefined();
    expect(activeKey("/moreover")).toBeUndefined();
  });

  it("no section owns an unrelated route", () => {
    expect(activeKey("/login")).toBeUndefined();
  });

  it("ignores a trailing slash on either side", () => {
    const assets = ALL.find((s) => s.key === "assets");
    expect(assets && isSectionActive(assets, "/assets/")).toBe(true);
  });

  it("a hidden section cannot be the active one", () => {
    expect(activeSection(visibleSections("DIRECTOR", ["CORE"]), "/finance/entries")).toBeUndefined();
  });

  it("keeps the cashier's Money row lit across the finance subtree (#264)", () => {
    const cashier = visibleSections("CASHIER", EVERY);
    expect(activeSection(cashier, "/finance/entries")?.key).toBe("finances");
    expect(activeSection(cashier, "/finance/record")?.key).toBe("finances");
  });
});

describe("row icons follow the consistency kit", () => {
  // kit.js ICONS name → the lucide icon drawing the same paths. Users has no
  // kit icon yet; it merges into Personnel with #266.
  const KIT = readFileSync(join(import.meta.dirname, "../../../../docs/design/consistency/kit.js"), "utf8");
  const ICONS: Record<string, [kit: string | undefined, icon: unknown]> = {
    home: ["home", House],
    assets: ["truck", Truck],
    activities: ["route", Route],
    maintenance: ["wrench", Wrench],
    finances: ["money", Banknote],
    more: ["menu", Menu],
    persons: ["user", UserRound],
    users: [undefined, ShieldUser],
    branches: ["building", Building],
    accountingMonths: ["cal", Calendar],
    companySettings: ["sliders", SlidersHorizontal],
  };

  it.each(ALL.map((section) => [section.key, section] as const))("%s", (key, section) => {
    const entry = ICONS[key];
    expect(entry, `${key} needs a kit icon in this table`).toBeDefined();
    const [kit, icon] = entry ?? [];
    if (kit !== undefined) expect(KIT).toMatch(new RegExp(`^\\s+${kit}: '`, "m"));
    expect(section.icon).toBe(icon);
  });
});
