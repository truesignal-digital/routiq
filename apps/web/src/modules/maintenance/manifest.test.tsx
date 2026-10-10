// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ROLES, type ModuleCode, type Role } from "@routiq/contracts";
import { visibleDashboardCards } from "../../dashboard/cards.js";
import { visibleEntryLinks } from "../../finance/EntryLinks.js";
import { bottomBarPlaces } from "../../shell/bottom-bar.js";
import { visibleSections } from "../../shell/sections.js";
import { applicableCounts } from "../../shell/useNavCounts.js";
import { permittedActions } from "../../vehicle/actions.js";
import type { VehicleGates } from "../../vehicle/context.js";
import { historyKinds } from "../../vehicle/tabs/HistoryTab.js";
import { ALL_MODULES, ASSET_ID, WORK_ORDER_ID, viewer, workOrderRow } from "../../vehicle/test/fixtures.js";
import { closeVehicle, openVehicle, requested } from "../../vehicle/test/harness.js";
import { visibleTabs } from "../../vehicle/VehicleTabsNav.js";
import { contributes, contributionOwner, type KeyedSlot } from "../manifest.js";
import { maintenanceManifest } from "./manifest.js";

const ON: ModuleCode[] = ALL_MODULES;
const OFF: ModuleCode[] = ALL_MODULES.filter((code) => code !== "MAINTENANCE");

/** Every gate open, so only the module decides what the vehicle shows. */
const OPEN_GATES: VehicleGates = {
  maintenance: true,
  money: true,
  entries: true,
  workOrderCosts: true,
  trips: true,
  documents: true,
};

const WORK_ORDER_LINK = {
  workOrderId: WORK_ORDER_ID,
  workOrderAssetId: ASSET_ID,
  workOrderNumber: 7,
  workOrderDescription: "Changer les plaquettes",
  activityId: null,
  activityNumber: null,
};

/** Everything Maintenance adds that this role sees, slot by slot. */
function contributionsFor(role: Role, modules: ModuleCode[]) {
  const actionKeys: readonly string[] = maintenanceManifest.vehicleActions;
  return {
    sidebar: visibleSections(role, modules).filter((row) => row.module === "MAINTENANCE").map((row) => row.key),
    bottomBar: bottomBarPlaces(role, modules).filter((row) => row.module === "MAINTENANCE").map((row) => row.key),
    counts: applicableCounts(role, modules).filter((count) => count.module === "MAINTENANCE").map((count) => count.key),
    homeCards: visibleDashboardCards(role, modules).filter((key) => contributionOwner("homeCards", key) === "MAINTENANCE"),
    tabs: visibleTabs(OPEN_GATES, modules).filter((tab) => tab === "maintenance"),
    actions: permittedActions(viewer(role, modules))
      .map((def) => def.key)
      .filter((key) => actionKeys.includes(key)),
    history: historyKinds(OPEN_GATES, modules).filter((kind) => kind === "MAINTENANCE"),
    workOrderLink: visibleEntryLinks(WORK_ORDER_LINK, modules).workOrder,
  };
}

const KEYED: Array<[KeyedSlot, readonly string[]]> = [
  ["navCounts", maintenanceManifest.navCounts.map((count) => count.key)],
  ["homeCards", maintenanceManifest.homeCards],
  ["vehicleTabs", maintenanceManifest.vehicleTabs],
  ["vehicleActions", maintenanceManifest.vehicleActions],
  ["recordPanels", maintenanceManifest.recordPanels],
  ["historyKinds", maintenanceManifest.historyKinds],
  ["fields", maintenanceManifest.fields],
];

describe("Maintenance's manifest", () => {
  it("owns every entry it names, and none of them shows with the module off", () => {
    for (const [slot, keys] of KEYED) {
      for (const key of keys) {
        expect(contributes(slot, key, ON), `${slot} ${key}`).toBe(true);
        expect(contributes(slot, key, OFF), `${slot} ${key}`).toBe(false);
      }
    }
  });

  it.each(ROLES)("leaves %s nothing of Maintenance once it is off", (role) => {
    expect(contributionsFor(role, OFF)).toEqual({
      sidebar: [],
      bottomBar: [],
      counts: [],
      homeCards: [],
      tabs: [],
      actions: [],
      history: [],
      workOrderLink: false,
    });
  });

  // What each role has while it is on, so the off state above removes something real.
  const WHEN_ON: Record<Role, { sidebar: string[]; bottomBar: string[]; counts: string[]; actions: string[] }> = {
    DIRECTOR: {
      sidebar: ["maintenance"],
      bottomBar: [],
      counts: ["maintenanceNew"],
      actions: [...maintenanceManifest.vehicleActions],
    },
    ADMIN: {
      sidebar: ["maintenance"],
      bottomBar: [],
      counts: ["maintenanceNew"],
      actions: [...maintenanceManifest.vehicleActions],
    },
    FINANCE: { sidebar: [], bottomBar: [], counts: [], actions: [] },
    CASHIER: { sidebar: [], bottomBar: [], counts: [], actions: [] },
    TECHNICIAN: {
      sidebar: ["maintenance"],
      bottomBar: ["maintenance"],
      counts: ["maintenanceNew"],
      actions: ["report-issue", "create-work-order", "complete-work-order", "cancel-work-order"],
    },
    DRIVER: { sidebar: [], bottomBar: [], counts: [], actions: ["report-issue"] },
  };

  it.each(ROLES)("gives %s its share of Maintenance while it is on", (role) => {
    expect(contributionsFor(role, ON)).toEqual({
      ...WHEN_ON[role],
      homeCards: [],
      tabs: ["maintenance"],
      history: ["MAINTENANCE"],
      workOrderLink: true,
    });
  });
});

describe("direct links with Maintenance off", () => {
  afterEach(async () => {
    cleanup();
    await closeVehicle();
  });

  const MAINTENANCE_READS = ["/v1/work-orders", "/v1/issues", "/v1/maintenance/summary", `/v1/work-orders/${WORK_ORDER_ID}`];
  const nothingRead = (recorded: Awaited<ReturnType<typeof openVehicle>>) =>
    MAINTENANCE_READS.flatMap((path) => requested(recorded, path));

  it.each(ROLES)("/maintenance tells %s the module is not included and reads nothing", async (role) => {
    const recorded = await openVehicle("/maintenance", { role, modules: OFF });
    expect(await screen.findByText("This module is not enabled for your workspace.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Maintenance" })).toBeTruthy();
    expect(nothingRead(recorded)).toEqual([]);
  });

  it("the vehicle's Maintenance section says the same, without its tab or its reads", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/maintenance`, { role: "TECHNICIAN", modules: OFF });
    expect(await screen.findByText("This module is not enabled for your workspace.")).toBeTruthy();
    const tabs = within(screen.getByRole("navigation", { name: "Vehicle sections" })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).not.toContain("Maintenance");
    expect(nothingRead(recorded)).toEqual([]);
  });

  it("a work order opened from a link is not there to see", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}?panel=work_order:${WORK_ORDER_ID}`, {
      role: "ADMIN",
      modules: OFF,
    });
    expect(await screen.findByText("Not available")).toBeTruthy();
    expect(nothingRead(recorded)).toEqual([]);
  });

  it("opens the same section, and reads it, once Maintenance is on", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/maintenance`, {
      role: "TECHNICIAN",
      modules: ON,
      workOrders: [workOrderRow("APPROVED")],
    });
    expect(await screen.findByRole("heading", { name: "Maintenance", level: 2 })).toBeTruthy();
    expect(requested(recorded, "/v1/work-orders").length).toBeGreaterThan(0);
    expect(screen.queryByText("This module is not enabled for your workspace.")).toBeNull();
  });
});
