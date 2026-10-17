import type { ComingUpResponse, TodoResponse } from "@routiq/contracts";

/**
 * The Trucks page's Documents tab filters (#665): EXPIRED, the To do's
 * expired papers; DUE_30, Coming up's papers expiring in the next 30 days.
 * Both come from the fleet attention reads (#661), so the Overview's tile and
 * the tab it opens count the same documents.
 */
export const FLEET_DOCUMENT_FILTERS = ["EXPIRED", "DUE_30"] as const;
export type FleetDocumentFilter = (typeof FLEET_DOCUMENT_FILTERS)[number];

/** The window the Trucks Overview looks ahead (`COMING_UP_WINDOWS`). */
export const FLEET_DOCUMENT_WINDOW_DAYS = 30;

export interface FleetDocumentRow {
  key: string;
  state: FleetDocumentFilter;
  documentId: string | null;
  asset: { id: string; assetCode: string } | null;
  typeLabelFr: string | null;
  typeLabelEn: string | null;
  /** ISO date. */
  expiresAt: string;
  /** Days from the business date; negative once expired. */
  daysLeft: number | null;
}

/**
 * Expired papers first, most overdue first, then the papers falling due,
 * soonest first. A row the server sent without an expiry is left out: these
 * rows exist because of their expiry.
 */
export function fleetDocumentRows(
  todo: TodoResponse | undefined,
  comingUp: ComingUpResponse | undefined,
): FleetDocumentRow[] {
  const expired: FleetDocumentRow[] = (todo?.rows ?? []).flatMap((row) =>
    row.code !== "DOCUMENT_EXPIRED" || row.params.expiresAt === undefined
      ? []
      : [
          {
            key: `expired:${row.link.id ?? row.asset?.id ?? row.since}`,
            state: "EXPIRED" as const,
            documentId: row.link.kind === "document" ? row.link.id : null,
            asset: row.asset,
            typeLabelFr: row.params.documentTypeLabelFr ?? null,
            typeLabelEn: row.params.documentTypeLabelEn ?? null,
            expiresAt: row.params.expiresAt,
            daysLeft: row.params.daysLeft ?? null,
          },
        ],
  );
  const due: FleetDocumentRow[] = (comingUp?.rows ?? []).flatMap((row) =>
    row.code !== "DOCUMENT_DUE"
      ? []
      : [
          {
            key: `due:${row.link.id ?? row.asset?.id ?? row.dueDate}`,
            state: "DUE_30" as const,
            documentId: row.link.kind === "document" ? row.link.id : null,
            asset: row.asset,
            typeLabelFr: row.params.documentTypeLabelFr ?? null,
            typeLabelEn: row.params.documentTypeLabelEn ?? null,
            expiresAt: row.dueDate,
            daysLeft: row.params.daysLeft ?? null,
          },
        ],
  );
  const byExpiry = (a: FleetDocumentRow, b: FleetDocumentRow) => a.expiresAt.localeCompare(b.expiresAt);
  return [...expired.sort(byExpiry), ...due.sort(byExpiry)];
}

/** The truck's Documents section with the paper open in its panel. */
export function fleetDocumentLink(row: FleetDocumentRow): { to: string; search?: Record<string, string> } | undefined {
  if (row.asset === null) return undefined;
  const to = `/assets/${row.asset.id}/documents`;
  return row.documentId === null ? { to } : { to, search: { panel: `document:${row.documentId}` } };
}

/**
 * Whether either read stopped at its row limit: then the lists are the first
 * rows, and the page says so instead of passing them off as all of them.
 */
export function fleetDocumentsTruncated(todo: TodoResponse | undefined, comingUp: ComingUpResponse | undefined): boolean {
  return (
    (todo !== undefined && todo.totalCount > todo.rows.length) ||
    (comingUp !== undefined && comingUp.totalCount > comingUp.rows.length)
  );
}
