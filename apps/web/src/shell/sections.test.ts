import { describe, expect, it } from "vitest";
import { ROLES, type ModuleCode, type Role } from "@routiq/contracts";
import { visibleFinanceSections } from "../finance/navigation.js";
import { canReadFinanceEntries, canRecordFinance } from "../finance/permissions.js";
import { canAdministerBranches } from "../branches/permissions.js";
import { canAdministerMembers } from "../members/permissions.js";
import { activeSection, isSectionActive, visibleSections } from "./sections.js";

const ALL = visibleSections(["CORE", "ASSETS", "FINANCE", "MAINTENANCE"]);

function activeKey(pathname: string): string | undefined {
  return activeSection(ALL, pathname)?.key;
}

describe("visibleSections (module gate)", () => {
  it("disabled module removes its section entirely", () => {
    const keys = visibleSections(["CORE"]).map((s) => s.key);
    expect(keys).toEqual(["home", "more"]);
  });

  it("enabled module shows its section", () => {
    const keys = visibleSections(["CORE", "ASSETS"]).map((s) => s.key);
    expect(keys).toEqual(["home", "assets", "more"]);
  });

  it("finance module shows the finances section", () => {
    const keys = visibleSections(["CORE", "FINANCE"]).map((s) => s.key);
    expect(keys).toEqual(["home", "finances", "more"]);
  });

  it("maintenance module shows the maintenance section", () => {
    const keys = visibleSections(["CORE", "MAINTENANCE"]).map((s) => s.key);
    expect(keys).toEqual(["home", "maintenance", "more"]);
  });

  it("without the maintenance module the workshop has no nav entry", () => {
    const keys = visibleSections(["CORE", "ASSETS", "FINANCE"]).map((s) => s.key);
    expect(keys).not.toContain("maintenance");
  });

  it("while membership is loading only module-less sections render", () => {
    expect(visibleSections(undefined).map((s) => s.key)).toEqual(["home", "more"]);
  });

  it("home leads the nav and survives every module combination", () => {
    for (const modules of [["CORE"], ["CORE", "ASSETS"], ["CORE", "FINANCE"]] as const) {
      expect(visibleSections([...modules])[0]?.key).toBe("home");
    }
    expect(visibleSections(undefined)[0]?.key).toBe("home");
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
    expect(activeKey("/finance/periods")).toBe("finances");
    expect(activeKey("/finance/approvals")).toBe("finances");
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
    expect(activeSection(visibleSections(["CORE"]), "/finance/entries")).toBeUndefined();
  });
});

describe("navigation per role (ADR-0009)", () => {
  const EVERY: ModuleCode[] = ["CORE", "ASSETS", "ACTIVITIES", "MAINTENANCE", "FINANCE", "DOCUMENTS"];

  /** Shell sections (with where Finances leads), finance tabs, and the More admin links. */
  const nav = (role: Role) => ({
    sections: visibleSections(EVERY, role).map((s) => (s.key === "finances" ? `finances:${s.to}` : s.key)),
    finance: visibleFinanceSections(role, EVERY).map((s) => s.key),
    users: canAdministerMembers(role),
    branches: canAdministerBranches(role),
  });

  const ALL_SECTIONS = ["home", "assets", "activities", "maintenance", "finances:/finance/entries", "more"];
  const expected: Record<Role, ReturnType<typeof nav>> = {
    DIRECTOR: { sections: ALL_SECTIONS, finance: ["entries", "approvals", "periods"], users: true, branches: true },
    ADMIN: { sections: ALL_SECTIONS, finance: ["entries"], users: true, branches: false },
    FINANCE: { sections: ALL_SECTIONS, finance: ["entries", "approvals", "periods"], users: false, branches: false },
    CASHIER: {
      sections: ["home", "assets", "finances:/finance/entries", "more"],
      finance: ["entries"],
      users: false,
      branches: false,
    },
    TECHNICIAN: {
      sections: ["home", "assets", "activities", "maintenance", "more"],
      finance: [],
      users: false,
      branches: false,
    },
    DRIVER: { sections: ALL_SECTIONS, finance: ["entries"], users: false, branches: false },
  };

  it.each(ROLES)("%s", (role) => {
    expect(nav(role)).toEqual(expected[role]);
  });

  it("keeps the cashier's Finances entry lit across the finance subtree (#264)", () => {
    const cashier = visibleSections(EVERY, "CASHIER");
    expect(activeSection(cashier, "/finance/entries")?.key).toBe("finances");
    expect(activeSection(cashier, "/finance/record")?.key).toBe("finances");
  });

  it("shows Finances exactly to the roles that read entries, so it never leads to a denial (#64)", () => {
    const withFinance = ROLES.filter((role) =>
      visibleSections(EVERY, role).some((section) => section.key === "finances"),
    );
    expect(withFinance).toEqual(ROLES.filter((role) => canReadFinanceEntries(role, EVERY)));
    expect(withFinance).toContain("CASHIER");
    expect(withFinance).not.toContain("TECHNICIAN");
    for (const role of ROLES) {
      expect(visibleSections(["CORE", "ASSETS"], role).some((s) => s.key === "finances"), role).toBe(false);
    }
  });

  it("gives every role that records money a Finances entry to read it back", () => {
    for (const role of ROLES) {
      if (!canRecordFinance(role, EVERY)) continue;
      expect(canReadFinanceEntries(role, EVERY), role).toBe(true);
    }
  });
});
