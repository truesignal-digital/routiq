import { describe, expect, it } from "vitest";
import { breadcrumbTrail } from "./breadcrumbs.js";
import { visibleSections } from "./sections.js";

const ALL = visibleSections(["CORE", "ASSETS", "FINANCE"]);

function trailAt(pathname: string) {
  return breadcrumbTrail(ALL, pathname).map(({ labelKey, to }) => [labelKey, to]);
}

describe("breadcrumbTrail", () => {
  it("stops at Home on the dashboard", () => {
    expect(trailAt("/")).toEqual([["nav.home", undefined]]);
  });

  it("names the section as the page on a section root", () => {
    expect(trailAt("/assets")).toEqual([
      ["nav.home", "/"],
      ["nav.assets", undefined],
    ]);
  });

  it("puts a page under its section", () => {
    expect(trailAt("/assets/new")).toEqual([
      ["nav.home", "/"],
      ["nav.assets", "/assets"],
      ["assets.register", undefined],
    ]);
  });

  it("names an asset detail page under Assets", () => {
    expect(trailAt("/assets/00000000-0000-4000-8000-000000000001")).toEqual([
      ["nav.home", "/"],
      ["nav.assets", "/assets"],
      ["assets.detail.breadcrumb", undefined],
    ]);
  });

  it("keeps the literal /assets/new ahead of the asset id pattern", () => {
    expect(trailAt("/assets/new").at(-1)).toEqual(["assets.register", undefined]);
  });

  it("resolves a param segment", () => {
    expect(trailAt("/assets/00000000-0000-4000-8000-000000000001/documents")).toEqual([
      ["nav.home", "/"],
      ["nav.assets", "/assets"],
      ["documents.link", undefined],
    ]);
  });

  it("labels a finance list under Finance", () => {
    expect(trailAt("/finance/entries")).toEqual([
      ["nav.home", "/"],
      ["nav.finances", "/finance/entries"],
      ["finance.navigation.entries", undefined],
    ]);
  });

  it("adds a fourth crumb for an entry, linking back to the list", () => {
    expect(trailAt("/finance/entries/00000000-0000-4000-8000-000000000010")).toEqual([
      ["nav.home", "/"],
      ["nav.finances", "/finance/entries"],
      ["finance.navigation.entries", "/finance/entries"],
      ["finance.entries.detail.breadcrumb", undefined],
    ]);
  });

  it("still names the record page, which no longer has a tab", () => {
    expect(trailAt("/finance/record")).toEqual([
      ["nav.home", "/"],
      ["nav.finances", "/finance/entries"],
      ["finance.navigation.record", undefined],
    ]);
  });

  it("covers the remaining finance pages", () => {
    expect(trailAt("/finance/approvals").at(-1)).toEqual([
      "finance.navigation.approvals",
      undefined,
    ]);
    expect(trailAt("/finance/periods").at(-1)).toEqual([
      "finance.navigation.periods",
      undefined,
    ]);
    expect(trailAt("/more")).toEqual([
      ["nav.home", "/"],
      ["nav.more", undefined],
    ]);
  });

  it("puts the people admin page under Plus", () => {
    expect(trailAt("/more/persons")).toEqual([
      ["nav.home", "/"],
      ["nav.more", "/more"],
      ["persons.title", undefined],
    ]);
  });

  it("never links the crumb you are already standing on", () => {
    for (const path of [
      "/",
      "/assets",
      "/assets/new",
      "/finance/entries",
      "/finance/entries/abc",
      "/finance/record",
      "/more",
    ]) {
      const trail = breadcrumbTrail(ALL, path);
      expect(trail.at(-1)?.to, path).toBeUndefined();
      expect(
        trail.slice(0, -1).every((crumb) => crumb.to !== undefined),
        path,
      ).toBe(true);
    }
  });

  it("matches whole segments, not prefixes", () => {
    // No page trail, so it falls back to the section crumb alone.
    expect(trailAt("/finance/entries-archive")).toEqual([
      ["nav.home", "/"],
      ["nav.finances", undefined],
    ]);
  });

  it("drops a section the workspace cannot see", () => {
    const withoutFinance = visibleSections(["CORE", "ASSETS"]);

    expect(
      breadcrumbTrail(withoutFinance, "/finance/entries").map(({ labelKey }) => labelKey),
    ).toEqual(["nav.home", "finance.navigation.entries"]);
  });
});
