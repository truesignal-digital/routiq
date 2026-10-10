import { Wrench } from "lucide-react";
import type { Role } from "@routiq/contracts";
import { maintenanceQueryKey } from "../../maintenance/query-key.js";
import type { WebModuleManifest } from "../manifest.js";

const WORKSHOP_PAGE_ROLES: readonly Role[] = ["DIRECTOR", "ADMIN", "TECHNICIAN"];

/**
 * Maintenance: problems reported on vehicles and the work orders that fix
 * them (contract: `MODULE_MANIFESTS` in `@routiq/contracts`). Everything below
 * goes away with the module, for every role.
 */
export const maintenanceManifest: WebModuleManifest = {
  code: "MAINTENANCE",
  navRows: [
    {
      key: "maintenance",
      group: "daily",
      place: { after: "activities" },
      labelKey: "maintenance.title",
      to: "/maintenance",
      icon: Wrench,
      // role-config: the workshop page is for the people who run repairs.
      reads: (role) => WORKSHOP_PAGE_ROLES.includes(role),
      // Opens the Problems tab on the open ones (#302 reads `tab` and `issueStatus`).
      count: {
        key: "maintenanceNew",
        labelKey: "shell.counts.maintenanceNew",
        to: "/maintenance",
        search: { tab: "issues", issueStatus: "OPEN" },
      },
    },
  ],
  navCounts: [{ key: "maintenanceNew", listKey: maintenanceQueryKey }],
  // Home has no workshop card yet.
  homeCards: [],
  vehicleTabs: ["maintenance"],
  vehicleActions: [
    "report-issue",
    "create-work-order",
    "approve-work-order",
    "complete-work-order",
    "approve-completion",
    "cancel-work-order",
    "release",
  ],
  recordPanels: ["work_order", "issue"],
  historyKinds: ["MAINTENANCE"],
  fields: ["entry.workOrderLink", "assets.attentionGrounding"],
};
