import { afterEach, describe, expect, it } from "vitest";
import { Wrench } from "lucide-react";
import {
  MODULE_MANIFESTS,
  NAV_COUNT_ROLES,
  VEHICLE_HISTORY_KINDS,
  type ModuleCode,
  type NavCountKey,
} from "@routiq/contracts";
import { HOME_CARD_KEYS, visibleDashboardCards } from "../dashboard/cards.js";
import { CORE_SECTION_KEYS, visibleSections } from "../shell/sections.js";
import { applicableCounts } from "../shell/useNavCounts.js";
import { PANEL_RECORD_KINDS, VEHICLE_ACTION_KEYS } from "../vehicle/model.js";
import { VEHICLE_TABS } from "../vehicle/VehicleTabsNav.js";
import { APP_MODULES } from "./index.js";
import {
  contributes,
  contributionOwner,
  FIELD_SLOTS,
  installedModules,
  installModules,
  pageOwner,
  webManifestProblems,
  type SlotCatalogue,
  type WebModuleManifest,
} from "./manifest.js";

/** What the application's slots hold today, read from the slots themselves. */
const CATALOGUE: SlotCatalogue = {
  keys: {
    navCounts: Object.keys(NAV_COUNT_ROLES),
    homeCards: HOME_CARD_KEYS,
    vehicleTabs: VEHICLE_TABS,
    vehicleActions: VEHICLE_ACTION_KEYS,
    recordPanels: [...PANEL_RECORD_KINDS, "readings"],
    historyKinds: VEHICLE_HISTORY_KINDS,
    fields: FIELD_SLOTS,
  },
  coreNavRows: CORE_SECTION_KEYS,
  modules: MODULE_MANIFESTS.map((manifest) => manifest.code),
};

const empty = (code: WebModuleManifest["code"], overrides: Partial<WebModuleManifest> = {}): WebModuleManifest => ({
  code,
  navRows: [],
  navCounts: [],
  homeCards: [],
  vehicleTabs: [],
  vehicleActions: [],
  recordPanels: [],
  historyKinds: [],
  fields: [],
  ...overrides,
});

afterEach(() => installModules(APP_MODULES));

describe("the application's manifests", () => {
  it("are installed, and every reference they make holds", () => {
    expect(installedModules()).toBe(APP_MODULES);
    expect(webManifestProblems(APP_MODULES, CATALOGUE)).toEqual([]);
  });
});

describe("webManifestProblems", () => {
  it("names a module twice, and one with no contract manifest", () => {
    const catalogue = { ...CATALOGUE, modules: ["ASSETS" as const] };
    expect(webManifestProblems([empty("ASSETS"), empty("ASSETS"), empty("FINANCE")], catalogue)).toEqual([
      "ASSETS has two web manifests",
      "FINANCE has no contract manifest",
    ]);
  });

  it("names a key no slot has", () => {
    // The types refuse both keys; the check still has to, for a slot that loses one.
    const manifest = { ...empty("FINANCE"), vehicleTabs: ["fuel"], fields: ["trip.customer"] } as unknown as WebModuleManifest;
    expect(webManifestProblems([manifest], CATALOGUE)).toEqual([
      'FINANCE names vehicleTabs "fuel", which does not exist',
      'FINANCE names fields "trip.customer", which does not exist',
    ]);
  });

  it("names an entry two modules claim", () => {
    expect(
      webManifestProblems(
        [empty("FINANCE", { vehicleTabs: ["money"] }), empty("DOCUMENTS", { vehicleTabs: ["money"] })],
        CATALOGUE,
      ),
    ).toEqual(['vehicleTabs "money" is claimed by FINANCE and DOCUMENTS']);
  });

  it("names a sidebar row that exists already, or is placed by one that does not", () => {
    const row = { group: "daily" as const, labelKey: "x", to: "/x", icon: Wrench };
    expect(
      webManifestProblems(
        [
          empty("FINANCE", {
            navRows: [
              { ...row, key: "home", place: { after: "users" } },
              { ...row, key: "x", place: { before: "nowhere" } },
            ],
          }),
        ],
        CATALOGUE,
      ),
    ).toEqual([
      'sidebar row "home" of FINANCE already exists',
      'sidebar row "x" of FINANCE is placed by "nowhere", which does not exist',
    ]);
  });
});

describe("the application's sidebar", () => {
  it("puts every module's row where its manifest places it", () => {
    const all: ModuleCode[] = ["CORE", "ASSETS", "DOCUMENTS", "FINANCE", "ACTIVITIES", "MAINTENANCE"];
    expect(visibleSections("DIRECTOR", all).map((row) => [row.key, row.module ?? "core"])).toEqual([
      ["home", "core"],
      ["assets", "ASSETS"],
      ["activities", "ACTIVITIES"],
      ["maintenance", "MAINTENANCE"],
      ["finances", "FINANCE"],
      ["persons", "ACTIVITIES"],
      ["users", "core"],
      ["branches", "core"],
      ["accountingMonths", "FINANCE"],
      ["companySettings", "FINANCE"],
    ]);
  });

  it("keeps core's rows with every module off", () => {
    expect(visibleSections("DIRECTOR", ["CORE"]).map((row) => row.key)).toEqual(["home", "users", "branches"]);
  });
});

describe("a module's contributions", () => {
  const fixture = empty("DOCUMENTS", {
    navRows: [{ key: "papers", group: "daily", place: { after: "home" }, labelKey: "papers.title", to: "/papers", icon: Wrench }],
    navCounts: [{ key: "moneyWaiting" as NavCountKey, listKey: () => ["papers"] }],
    homeCards: ["assets"],
    vehicleTabs: ["documents"],
  });

  const on: ModuleCode[] = ["CORE", "ASSETS", "DOCUMENTS"];
  const off: ModuleCode[] = ["CORE", "ASSETS"];

  it("show while the module is on and go with it, whatever the slot", () => {
    installModules([fixture]);
    expect(contributionOwner("vehicleTabs", "documents")).toBe("DOCUMENTS");
    expect(contributionOwner("vehicleTabs", "now")).toBeUndefined();

    expect(contributes("vehicleTabs", "documents", on)).toBe(true);
    expect(contributes("vehicleTabs", "documents", off)).toBe(false);
    expect(contributes("vehicleTabs", "now", off)).toBe(true);
    // Membership still loading: no module's entry yet.
    expect(contributes("vehicleTabs", "documents", undefined)).toBe(false);

    expect(visibleSections("DIRECTOR", on).map((row) => row.key)).toContain("papers");
    expect(visibleSections("DIRECTOR", off).map((row) => row.key)).not.toContain("papers");
    expect(visibleDashboardCards("DIRECTOR", on)).toContain("assets");
    expect(visibleDashboardCards("DIRECTOR", off)).not.toContain("assets");
    expect(applicableCounts("DIRECTOR", [...on, "FINANCE"]).map((count) => count.module)).toContain("DOCUMENTS");
    expect(applicableCounts("DIRECTOR", [...off, "FINANCE"]).map((count) => count.module)).not.toContain("DOCUMENTS");
  });

  it("place a module's row beside the row it names, and own the pages under it", () => {
    installModules([fixture]);
    const keys = visibleSections("DIRECTOR", ["CORE", "ASSETS", "DOCUMENTS", "ACTIVITIES"]).map((row) => row.key);
    expect(keys).toEqual(["home", "papers", "users", "branches"]);
    expect(pageOwner("/papers/42")?.code).toBe("DOCUMENTS");
    expect(pageOwner("/papers-archive")).toBeUndefined();
    expect(pageOwner("/more/users")).toBeUndefined();
  });
});
