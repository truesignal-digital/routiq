import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import fr from "../i18n/locales/fr.json";
import { breadcrumbTrail } from "./breadcrumbs.js";
import { visibleSections } from "./sections.js";
import { VEHICLE_TABS } from "../vehicle/VehicleTabsNav.js";

const ALL = visibleSections("DIRECTOR", ["CORE", "ASSETS", "ACTIVITIES", "FINANCE"]);
const TRIP = "/activities/00000000-0000-4000-8000-000000000020";

function trailAt(pathname: string) {
  return breadcrumbTrail(ALL, pathname).map(({ labelKey, to }) => [labelKey, to]);
}

function hasKey(catalog: unknown, key: string): boolean {
  let node = catalog;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string";
}

describe("breadcrumbTrail", () => {
  // Trails are data, so the literal t("…") scan in locales.test.ts never sees them.
  it("names every crumb with a key both catalogs have", () => {
    const source = readFileSync(join(import.meta.dirname, "breadcrumbs.ts"), "utf8");
    const keys = [...source.matchAll(/labelKey: "([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => !hasKey(en, key) || !hasKey(fr, key))).toEqual([]);
  });

  it("stops at Home on the dashboard", () => {
    expect(trailAt("/")).toEqual([["home.title", undefined]]);
  });

  it("names the section as the page on a section root", () => {
    expect(trailAt("/assets")).toEqual([
      ["home.title", "/"],
      ["assets.title", undefined],
    ]);
  });

  it("puts a page under its section", () => {
    expect(trailAt("/assets/new")).toEqual([
      ["home.title", "/"],
      ["assets.title", "/assets"],
      ["commands.register-asset.label", undefined],
    ]);
  });

  it("names an asset detail page under Assets", () => {
    expect(trailAt("/assets/00000000-0000-4000-8000-000000000001")).toEqual([
      ["home.title", "/"],
      ["assets.title", "/assets"],
      ["assets.detail.breadcrumb", undefined],
    ]);
  });

  it("keeps the literal /assets/new ahead of the asset id pattern", () => {
    expect(trailAt("/assets/new").at(-1)).toEqual(["commands.register-asset.label", undefined]);
  });

  it("names the truck record on the Details tab (#126)", () => {
    expect(trailAt("/assets/00000000-0000-4000-8000-000000000001/details")).toEqual([
      ["home.title", "/"],
      ["assets.title", "/assets"],
      ["assets.detail.breadcrumb", undefined],
    ]);
  });

  it("keeps the vehicle's crumb on every workspace section", () => {
    // Driven by the tab list, so a new vehicle tab without a crumb fails here.
    for (const section of VEHICLE_TABS.filter((tab) => tab !== "now")) {
      expect(trailAt(`/assets/00000000-0000-4000-8000-000000000001/${section}`), section).toEqual([
        ["home.title", "/"],
        ["assets.title", "/assets"],
        ["assets.detail.breadcrumb", undefined],
      ]);
    }
  });

  it("puts a trip under Trips, so a phone can step back to the list", () => {
    expect(trailAt(TRIP)).toEqual([
      ["home.title", "/"],
      ["activities.title", "/activities"],
      ["activities.detail.breadcrumb", undefined],
    ]);
  });

  it("names the trip by its number once the screen has it", () => {
    expect(breadcrumbTrail(ALL, TRIP, "TR-0042").at(-1)).toEqual({
      labelKey: "activities.detail.breadcrumb",
      label: "TR-0042",
      record: true,
    });
  });

  it("never puts a record's name on a page that is not a record", () => {
    expect(breadcrumbTrail(ALL, "/activities/record", "TR-0042").at(-1)).toEqual({
      labelKey: "commands.record-journey-sheet.label",
    });
  });

  it("names Record a trip under Trips, ahead of the trip id pattern", () => {
    expect(trailAt("/activities/record")).toEqual([
      ["home.title", "/"],
      ["activities.title", "/activities"],
      ["commands.record-journey-sheet.label", undefined],
    ]);
  });

  it("labels a finance list under Finance", () => {
    expect(trailAt("/finance/entries")).toEqual([
      ["home.title", "/"],
      ["finance.entries.title", "/finance/entries"],
      ["finance.navigation.entries", undefined],
    ]);
  });

  it("adds a fourth crumb for an entry, linking back to the list", () => {
    expect(trailAt("/finance/entries/00000000-0000-4000-8000-000000000010")).toEqual([
      ["home.title", "/"],
      ["finance.entries.title", "/finance/entries"],
      ["finance.navigation.entries", "/finance/entries"],
      ["finance.entries.detail.breadcrumb", undefined],
    ]);
  });

  it("still names the record page, which no longer has a tab", () => {
    expect(trailAt("/finance/record")).toEqual([
      ["home.title", "/"],
      ["finance.entries.title", "/finance/entries"],
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
      ["home.title", "/"],
      ["more.title", undefined],
    ]);
  });

  it("names a Company page once: its row is the section", () => {
    expect(trailAt("/more/persons")).toEqual([
      ["home.title", "/"],
      ["persons.title", undefined],
    ]);
    expect(trailAt("/more/users")).toEqual([
      ["home.title", "/"],
      ["users.title", undefined],
    ]);
  });

  it("starts every row's trail with Home, then the row's own label (#312)", () => {
    for (const section of ALL.filter((row) => row.key !== "home")) {
      const [home, first] = breadcrumbTrail(ALL, section.to);
      expect(home?.labelKey, section.key).toBe("home.title");
      expect(first?.labelKey, section.key).toBe(section.labelKey);
    }
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
      ["home.title", "/"],
      ["finance.entries.title", undefined],
    ]);
  });

  it("drops a section the workspace cannot see", () => {
    const withoutFinance = visibleSections("DIRECTOR", ["CORE", "ASSETS"]);

    expect(
      breadcrumbTrail(withoutFinance, "/finance/entries").map(({ labelKey }) => labelKey),
    ).toEqual(["home.title", "finance.navigation.entries"]);
  });
});
