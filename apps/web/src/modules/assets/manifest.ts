import { Truck } from "lucide-react";
import type { WebModuleManifest } from "../manifest.js";

/**
 * Assets: the fleet list and every vehicle's own page (contract:
 * `MODULE_MANIFESTS` in `@routiq/contracts`). Off, the Trucks row and the
 * pages under /assets go, with the vehicle actions that change the vehicle.
 */
export const assetsManifest: WebModuleManifest = {
  code: "ASSETS",
  navRows: [
    { key: "assets", group: "daily", place: { after: "home" }, labelKey: "assets.title", to: "/assets", icon: Truck },
  ],
  navCounts: [],
  homeCards: ["assets"],
  vehicleTabs: [],
  vehicleActions: ["change-custodian", "transfer-branch", "commission"],
  recordPanels: [],
  historyKinds: [],
  fields: [],
};
