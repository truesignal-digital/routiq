import type { WebModuleManifest } from "../manifest.js";

/**
 * Documents: a vehicle's papers and their expiry (contract: `MODULE_MANIFESTS`
 * in `@routiq/contracts`). It has no page of its own; it lives on the vehicle.
 */
export const documentsManifest: WebModuleManifest = {
  code: "DOCUMENTS",
  // Its forms pick the vehicle a paper belongs to.
  uses: ["ASSETS"],
  navRows: [],
  navCounts: [],
  homeCards: [],
  vehicleTabs: ["documents"],
  vehicleActions: ["add-document", "renew-document"],
  recordPanels: ["document"],
  historyKinds: ["DOCUMENTS"],
  fields: [],
};
