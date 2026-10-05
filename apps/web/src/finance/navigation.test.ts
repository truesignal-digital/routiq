import { describe, expect, it } from "vitest";
import { activeFinanceSection, visibleFinanceSections } from "./navigation.js";

const ALL = visibleFinanceSections("FINANCE", ["CORE", "FINANCE"]);

function activeKeyAt(pathname: string): string | undefined {
  return activeFinanceSection(ALL, pathname)?.key;
}

describe("activeFinanceSection", () => {
  it("gives each section its own route and no one else's", () => {
    expect(activeKeyAt("/finance/entries")).toBe("entries");
    expect(activeKeyAt("/finance/approvals")).toBe("approvals");
    expect(activeKeyAt("/finance/periods")).toBe("periods");
  });

  it("claims nothing on the record route, which lost its tab", () => {
    // Recording is reached from the entries action button, not a tab.
    expect(activeKeyAt("/finance/record")).toBeUndefined();
    expect(ALL.map(({ key }) => key)).toEqual(["entries", "approvals", "periods"]);
  });

  it("keeps the parent section on a child route", () => {
    expect(activeKeyAt("/finance/entries/00000000-0000-4000-8000-000000000010")).toBe(
      "entries",
    );
  });

  it("tolerates a trailing slash", () => {
    expect(activeKeyAt("/finance/periods/")).toBe("periods");
  });

  it("matches whole segments, not string prefixes", () => {
    expect(activeKeyAt("/finance/entries-archive")).toBeUndefined();
    expect(activeKeyAt("/finance/recording")).toBeUndefined();
  });

  it("claims nothing outside the finance subtree", () => {
    expect(activeKeyAt("/assets")).toBeUndefined();
    expect(activeKeyAt("/finance")).toBeUndefined();
  });

  it("cannot activate a section the role does not see", () => {
    const submitterSections = visibleFinanceSections("DRIVER", [
      "CORE",
      "FINANCE",
    ]);

    expect(activeFinanceSection(submitterSections, "/finance/periods")).toBeUndefined();
    expect(activeFinanceSection(submitterSections, "/finance/entries")?.key).toBe(
      "entries",
    );
  });
});
