import { useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { VisibilityState } from "@tanstack/react-table";
import type { DataTableColumn } from "@/components/data-table.js";
import type { FinancialEntryListItem } from "@routiq/contracts";
import { StatusBadge } from "@/components/status-badge.js";
import { EntryLinks } from "@/finance/EntryLinks.js";
import { EntryEventStatus, foldedAmountClass, isFolded } from "@/finance/EntryCancellation.js";
import { formatDate, formatMoney, localizedLabel } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

export type FinanceEntryColumnId =
  | "entryNumber"
  | "status"
  | "economicDate"
  | "postedAt"
  | "category"
  | "amount"
  | "counterpartyName"
  | "linkedTo";

/**
 * One definition per column, shared by every screen that lists entries, so the
 * home screen and the entries list cannot drift on what a status chip or an
 * amount looks like.
 *
 * `enableSorting` marks the columns `/v1/finance/entries` declares as
 * `sortFields`; their ids are the field names the read expects, and a screen
 * that turns sorting on must forward it as the `sort` param. The rest are not
 * sortable — a header control over them could only reorder the loaded page and
 * would misrepresent everything past the cursor.
 */
function buildColumns(
  t: (key: string) => string,
): Record<FinanceEntryColumnId, DataTableColumn<FinancialEntryListItem>> {
  return {
    entryNumber: {
      accessorKey: "entryNumber",
      header: t("finance.entries.detail.entryNumber"),
      enableSorting: true,
      meta: { phone: "title", label: t("finance.entries.detail.entryNumber") },
      cell: ({ row }) => (
        <span className="tabular-nums whitespace-nowrap">{row.original.entryNumber}</span>
      ),
    },
    status: {
      accessorKey: "status",
      header: t("finance.entries.detail.status"),
      meta: { phone: "status", label: t("finance.entries.detail.status") },
      cell: ({ row }) => (
        <div className="flex flex-wrap items-start gap-2">
          <EntryEventStatus entry={row.original} />
          {row.original.isLatePosting && (
            <StatusBadge tone="warning">
              {t("finance.entries.detail.latePosting")}
            </StatusBadge>
          )}
        </div>
      ),
    },
    economicDate: {
      accessorKey: "economicDate",
      header: t("finance.entries.detail.date"),
      enableSorting: true,
      meta: { phone: "meta", label: t("finance.entries.detail.date") },
      cell: ({ row }) => formatDate(row.original.economicDate),
    },
    postedAt: {
      accessorKey: "postedAt",
      header: t("finance.entries.detail.postingDate"),
      enableSorting: true,
      // Off the phone row: it is the read's default order, not something an
      // operator scans a phone for.
      meta: { phone: "hidden", label: t("finance.entries.detail.postingDate") },
      cell: ({ row }) => formatDate(row.original.postedAt),
    },
    category: {
      id: "category",
      header: t("finance.entries.detail.category"),
      meta: { phone: "meta", label: t("finance.entries.detail.category") },
      cell: ({ row }) => (
        <span className="whitespace-normal">{localizedLabel(row.original.category)}</span>
      ),
    },
    amount: {
      id: "amount",
      // The accessor is what makes the column sortable at all — TanStack
      // refuses to sort a display column. The id stays `amount` because that
      // is the field name the read declares.
      accessorKey: "amountMinor",
      header: t("finance.entries.detail.amount"),
      enableSorting: true,
      meta: { phone: "value", label: t("finance.entries.detail.amount") },
      cell: ({ row }) => (
        <span
          className={cn(
            "text-right tabular-nums font-semibold whitespace-nowrap",
            foldedAmountClass(row.original),
          )}
        >
          {formatMoney(row.original.amountMinor, {
            currency: row.original.currency,
            sign: { context: "ledger", direction: row.original.direction },
          })}
          {isFolded(row.original) && (
            <span className="sr-only"> {t("finance.entries.events.countsZero")}</span>
          )}
        </span>
      ),
    },
    counterpartyName: {
      accessorKey: "counterpartyName",
      header: t("finance.entries.detail.counterparty"),
      meta: {
        phone: "meta",
        label: t("finance.entries.detail.counterparty"),
      },
      cell: ({ row }) => (
        <span className="whitespace-normal">{row.original.counterpartyName ?? "—"}</span>
      ),
    },
    linkedTo: {
      id: "linkedTo",
      header: t("finance.entries.detail.linkedTo"),
      meta: { phone: "hidden", label: t("finance.entries.detail.linkedTo") },
      cell: ({ row }) => (
        <span className="whitespace-normal">
          <EntryLinks links={row.original.links} />
        </span>
      ),
    },
  };
}

/**
 * Columns in the requested order. Pass a module-level constant for `ids` — the
 * memo keys off its identity, and a literal rebuilt each render would defeat it.
 */
export function useFinanceEntryColumns(
  ids: readonly FinanceEntryColumnId[],
): DataTableColumn<FinancialEntryListItem>[] {
  const { t, i18n } = useTranslation();

  return useMemo(() => {
    const columns = buildColumns(t);
    return ids.map((id) => columns[id]);
    // `t` is stable across a language change, so the language itself is the dep
    // that rebuilds the localized headers and cells.
  }, [ids, i18n.resolvedLanguage, t]);
}

/**
 * The full entries list needs about 1045 px in French, which a 1440 px screen
 * with the sidebar open has and a 1280 px one (990 px card) does not (#436).
 * Below that the list starts without Counterparty — the drawer and the detail
 * still show it, and the view menu brings it back — so the row actions stay on
 * screen. Posting date stays: the list is sorted by it, and a list is never
 * sorted by a column the viewer can't see.
 */
const ROOMY_SCREEN_QUERY = "(min-width: 1440px)";
const ROOMY_VISIBILITY: VisibilityState = {};
const NARROW_VISIBILITY: VisibilityState = { counterpartyName: false };

function subscribeRoomy(onChange: () => void): () => void {
  const query = window.matchMedia(ROOMY_SCREEN_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Column visibility for the entries list until the operator picks their own. */
export function useEntryListDefaultVisibility(): VisibilityState {
  const roomy = useSyncExternalStore(
    subscribeRoomy,
    () => window.matchMedia(ROOMY_SCREEN_QUERY).matches,
    () => true,
  );
  return roomy ? ROOMY_VISIBILITY : NARROW_VISIBILITY;
}
