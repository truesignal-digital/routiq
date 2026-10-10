import { Route, UserRound } from "lucide-react";
import type { Role } from "@routiq/contracts";
import type { WebModuleManifest } from "../manifest.js";

const onlyFor =
  (roles: readonly Role[]) =>
  (role: Role): boolean =>
    roles.includes(role);

/**
 * Trips: trips, their sheets, odometer readings and the people who drive
 * (contract: `MODULE_MANIFESTS` in `@routiq/contracts`).
 */
export const activitiesManifest: WebModuleManifest = {
  code: "ACTIVITIES",
  // A trip runs vehicles and shows the money recorded on it.
  uses: ["ASSETS", "FINANCE"],
  navRows: [
    {
      key: "activities",
      group: "daily",
      place: { after: "assets" },
      labelKey: "activities.title",
      to: "/activities",
      icon: Route,
      // role-config: the counter and the workshop have no trips to run (ADR-0009).
      reads: onlyFor(["DIRECTOR", "ADMIN", "FINANCE", "DRIVER"]),
    },
    {
      key: "persons",
      group: "company",
      place: { before: "users" },
      labelKey: "persons.title",
      to: "/more/persons",
      icon: UserRound,
      reads: onlyFor(["DIRECTOR", "ADMIN", "FINANCE"]),
    },
  ],
  navCounts: [],
  homeCards: [],
  vehicleTabs: ["trips"],
  vehicleActions: ["record-reading", "start-trip"],
  recordPanels: ["trip", "readings"],
  historyKinds: ["TRIPS", "READINGS"],
  fields: ["entry.tripLink", "vehicle.lastTrip"],
};
