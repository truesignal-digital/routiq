import type { WebModuleManifest } from "../manifest.js";

/**
 * Scheduling: planned trips (ADR-0012; contract: `MODULE_MANIFESTS` in
 * `@routiq/contracts`). So far it adds the Planning tab to the Trips page;
 * the planning board and the driver's schedule come later.
 */
export const schedulingManifest: WebModuleManifest = {
  code: "SCHEDULING",
  // Its tab sits on the Trips page and lists trips.
  uses: ["ACTIVITIES"],
  navRows: [],
  navCounts: [],
  homeCards: [],
  vehicleTabs: [],
  vehicleActions: [],
  recordPanels: [],
  historyKinds: [],
  fields: [],
  pageTabs: ["activities.planning"],
};
