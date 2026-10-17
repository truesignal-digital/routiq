import {
  canReadLedger,
  moneyReadScope,
  type ModuleCode,
  type Role,
  type TripCancellationReason,
} from "@routiq/contracts";
import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { AuthContext } from "../auth/types.js";
import { activities, assets, persons, places } from "../db/schema.js";
import { serializeMinor } from "./serialize-minor.js";

/** The `activities` columns the plan reads, on the table or an alias of it. */
type TripTable = Record<
  | "workspaceId"
  | "plannedAssetId"
  | "plannedDriverPersonId"
  | "plannedOriginPlaceId"
  | "plannedOriginText"
  | "plannedDestinationPlaceId"
  | "plannedDestinationText",
  AnyPgColumn
>;

/**
 * Who reads a trip's agreed price and amount to collect (ADR-0012 §7): the
 * roles that read the ledger, with FINANCE on. Enforced here, in every read
 * that serves them, never only hidden in the UI. A driver's own-trip price
 * waits on the company setting (#344, #348); until then it is withheld.
 */
export function tripPricesVisible(auth: AuthContext, modules: ReadonlySet<ModuleCode>): boolean {
  return canReadLedger(auth.role) && modules.has("FINANCE");
}

/**
 * Who reads the revenue lines of a trip (#583): everyone who reads entries
 * except the driver. Revenue on a trip is its price, which a driver does not
 * see (ADR-0012 §7), even on an entry they recorded before #570 stopped
 * drivers recording revenue. Their expenses stay theirs to read.
 */
export function tripRevenueVisible(role: Role): boolean {
  return moneyReadScope(role) !== "OWN_ENTRIES";
}

/** The price keys for one trip: present for those who may read them, omitted for everyone else. */
export function tripPrices(
  visible: boolean,
  row: { agreedPriceMinor: bigint | null; amountToCollectMinor: bigint | null },
): { agreedPriceMinor?: number | null; amountToCollectMinor?: number | null } {
  if (!visible) return {};
  return {
    agreedPriceMinor: row.agreedPriceMinor === null ? null : serializeMinor(row.agreedPriceMinor),
    amountToCollectMinor:
      row.amountToCollectMinor === null ? null : serializeMinor(row.amountToCollectMinor),
  };
}

export function plannedAssetCodeSql(trip: TripTable = activities): SQL<string | null> {
  return sql<string | null>`(
    select ${assets.assetCode} from ${assets}
    where ${assets.workspaceId} = ${trip.workspaceId} and ${assets.id} = ${trip.plannedAssetId}
  )`;
}

export function plannedDriverNameSql(trip: TripTable = activities): SQL<string | null> {
  return sql<string | null>`(
    select ${persons.displayName} from ${persons}
    where ${persons.workspaceId} = ${trip.workspaceId} and ${persons.id} = ${trip.plannedDriverPersonId}
  )`;
}

/** One end of the planned route: the place's name, else the text typed. */
export function plannedRouteEndSql(
  end: "origin" | "destination",
  trip: TripTable = activities,
): SQL<string | null> {
  const placeId = end === "origin" ? trip.plannedOriginPlaceId : trip.plannedDestinationPlaceId;
  const text = end === "origin" ? trip.plannedOriginText : trip.plannedDestinationText;
  return sql<string | null>`coalesce(
    (select ${places.name} from ${places}
     where ${places.workspaceId} = ${trip.workspaceId} and ${places.id} = ${placeId}),
    ${text}
  )`;
}

/** A cancelled booking's reason, kept even after a late start revived it. */
export function cancellationOf(row: {
  cancelledAt: Date | null;
  cancellationReason: TripCancellationReason | null;
  cancellationNote: string | null;
}): { at: string; reason: TripCancellationReason; note: string | null } | null {
  if (row.cancelledAt === null || row.cancellationReason === null) return null;
  return {
    at: row.cancelledAt.toISOString(),
    reason: row.cancellationReason,
    note: row.cancellationNote,
  };
}
