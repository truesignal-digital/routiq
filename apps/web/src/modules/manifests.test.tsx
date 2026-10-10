// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MODULE_MANIFESTS, ROLES, type ModuleCode, type Role, type ToggleableModuleCode } from "@routiq/contracts";
import { visibleDashboardCards, visibleHomePanels } from "../dashboard/cards.js";
import { visibleEntryLinks } from "../finance/EntryLinks.js";
import { bottomBarPlaces } from "../shell/bottom-bar.js";
import { visibleSections } from "../shell/sections.js";
import { applicableCounts } from "../shell/useNavCounts.js";
import { permittedActions } from "../vehicle/actions.js";
import type { VehicleGates } from "../vehicle/context.js";
import { PANEL_RECORD_KINDS } from "../vehicle/model.js";
import { historyKinds } from "../vehicle/tabs/HistoryTab.js";
import { ASSET_ID, viewer } from "../vehicle/test/fixtures.js";
import { closeVehicle, openVehicle, type Recorded } from "../vehicle/test/harness.js";
import { visibleTabs, type VehicleTab } from "../vehicle/VehicleTabsNav.js";
import { APP_MODULES } from "./index.js";
import { contributes, contributionOwner, FIELD_SLOTS } from "./manifest.js";

/**
 * Every migrated module, on and off, for every role (#328): whatever the
 * application shows is owned by core or by a module that is on. The modules
 * with a screen are the ones with a web manifest.
 */
const MODULES = APP_MODULES.map((manifest) => manifest.code);

/** Every gate open, so only the modules decide what the vehicle offers. */
const OPEN_GATES: VehicleGates = {
  maintenance: true,
  money: true,
  entries: true,
  workOrderEstimate: true,
  workOrderCosts: true,
  trips: true,
  documents: true,
};

const LINKS = {
  workOrderId: "00000000-0000-4000-8000-00000000d001",
  workOrderAssetId: ASSET_ID,
  workOrderNumber: 7,
  workOrderDescription: "Changer les plaquettes",
  activityId: "00000000-0000-4000-8000-00000000b001",
  activityNumber: "DLA-2026-00042",
};

type Owner = ToggleableModuleCode | "core";

/** What this role sees with these modules on, each entry named with its owner. */
function shown(role: Role, modules: ModuleCode[]): Array<[string, Owner]> {
  const own = (owner: ToggleableModuleCode | undefined): Owner => owner ?? "core";
  const links = visibleEntryLinks(LINKS, modules);
  return [
    ...visibleSections(role, modules).map((row): [string, Owner] => [`sidebar ${row.key}`, own(row.module)]),
    ...bottomBarPlaces(role, modules).map((row): [string, Owner] => [`bar ${row.key}`, own(row.module)]),
    ...applicableCounts(role, modules).map((count): [string, Owner] => [`count ${count.key}`, count.module]),
    ...[...visibleDashboardCards(role, modules), ...visibleHomePanels(role, modules)].map((key): [string, Owner] => [
      `home ${key}`,
      own(contributionOwner("homeCards", key)),
    ]),
    ...visibleTabs(OPEN_GATES, modules).map((tab): [string, Owner] => [`tab ${tab}`, own(contributionOwner("vehicleTabs", tab))]),
    ...permittedActions(viewer(role, modules)).map((def): [string, Owner] => [
      `action ${def.key}`,
      own(contributionOwner("vehicleActions", def.key)),
    ]),
    ...historyKinds(OPEN_GATES, modules).map((kind): [string, Owner] => [`history ${kind}`, own(contributionOwner("historyKinds", kind))]),
    ...[...PANEL_RECORD_KINDS, "readings"]
      .filter((kind) => contributes("recordPanels", kind, modules))
      .map((kind): [string, Owner] => [`panel ${kind}`, own(contributionOwner("recordPanels", kind))]),
    ...FIELD_SLOTS.filter((field) => contributes("fields", field, modules)).map((field): [string, Owner] => [
      `field ${field}`,
      own(contributionOwner("fields", field)),
    ]),
    ...(links.workOrder ? [["link workOrder", "MAINTENANCE"] as [string, Owner]] : []),
    ...(links.trip ? [["link trip", "ACTIVITIES"] as [string, Owner]] : []),
  ];
}

/** Every combination of the modules with a screen, CORE always on. */
const COMBINATIONS: ModuleCode[][] = Array.from({ length: 2 ** MODULES.length }, (_, mask) => [
  "CORE",
  ...MODULES.filter((_, index) => (mask & (1 << index)) !== 0),
]);

describe("the contribution matrix", () => {
  it.each(ROLES)("shows %s nothing of a module that is off, in any combination", (role) => {
    for (const modules of COMBINATIONS) {
      const leaked = shown(role, modules).filter(([, owner]) => owner !== "core" && !modules.includes(owner));
      expect(leaked, modules.join(",")).toEqual([]);
    }
  });

  it.each(MODULES)("%s on gives some role something, and off takes all of it away", (code) => {
    const all: ModuleCode[] = ["CORE", ...MODULES];
    const without = all.filter((module) => module !== code);
    const owned = (modules: ModuleCode[]) =>
      ROLES.flatMap((role) => shown(role, modules).filter(([, owner]) => owner === code));
    expect(owned(all).length).toBeGreaterThan(0);
    expect(owned(without)).toEqual([]);
  });

  it("keeps core's pages with every module off", () => {
    expect(shown("DIRECTOR", ["CORE"])).toEqual([
      ["sidebar home", "core"],
      ["sidebar users", "core"],
      ["sidebar branches", "core"],
      ["bar home", "core"],
      ["tab now", "core"],
      ["tab details", "core"],
      ["tab history", "core"],
      ["action add-note", "core"],
      ["history ASSIGNMENTS", "core"],
      ["history LIFECYCLE", "core"],
      ["history NOTES", "core"],
      ["panel note", "core"],
    ]);
  });
});

/** The reads a module owns, as patterns over request paths (`MODULE_MANIFESTS`). */
function readsOf(code: ToggleableModuleCode): RegExp[] {
  const manifest = MODULE_MANIFESTS.find((candidate) => candidate.code === code);
  return (manifest?.reads ?? []).map((path) => new RegExp(`^${path.replace(/:[a-zA-Z]+/g, "[^/]+")}$`));
}

function moduleReads(recorded: Recorded, code: ToggleableModuleCode): string[] {
  const patterns = readsOf(code);
  return recorded.requests
    .map((request) => request.url.pathname)
    .filter((path) => patterns.some((pattern) => pattern.test(path)));
}

const PAGES: Array<[ToggleableModuleCode, string]> = APP_MODULES.flatMap((manifest) =>
  manifest.navRows.map((row): [ToggleableModuleCode, string] => [manifest.code, row.to]),
);

const TABS: Array<[ToggleableModuleCode, VehicleTab]> = APP_MODULES.flatMap((manifest) =>
  manifest.vehicleTabs.map((tab): [ToggleableModuleCode, VehicleTab] => [manifest.code, tab]),
);

describe("direct links to a module that is off", () => {
  afterEach(async () => {
    cleanup();
    await closeVehicle();
  });

  const NOT_INCLUDED = "This module is not enabled for your company.";

  it.each(PAGES)("%s's page %s says it is not included and reads nothing of it", async (code, path) => {
    const recorded = await openVehicle(path, { role: "DIRECTOR", modules: ["CORE", ...MODULES.filter((m) => m !== code)] });
    expect(await screen.findByText(NOT_INCLUDED)).toBeTruthy();
    expect(moduleReads(recorded, code)).toEqual([]);
  });

  it("the vehicle's status says nothing about trips while Trips is off", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "DIRECTOR", modules: ["CORE", ...MODULES.filter((m) => m !== "ACTIVITIES")] });
    expect(await screen.findByText("In service since March 2024.")).toBeTruthy();
    expect(screen.queryByText(/(trip|activit).* yet/i)).toBeNull();
    cleanup();
    await closeVehicle();
    await openVehicle(`/assets/${ASSET_ID}`, { role: "DIRECTOR", modules: ["CORE", ...MODULES] });
    expect(await screen.findByText(/^In service since March 2024; no (trips|activities) yet\.$/)).toBeTruthy();
  });

  it.each(TABS)("%s's vehicle section %s says the same", async (code, tab) => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/${tab}`, {
      role: "DIRECTOR",
      modules: ["CORE", ...MODULES.filter((m) => m !== code)],
    });
    expect(await screen.findByText(NOT_INCLUDED)).toBeTruthy();
    expect(moduleReads(recorded, code)).toEqual([]);
  });
});
