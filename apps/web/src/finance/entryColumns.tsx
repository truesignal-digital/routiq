import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import type { FinancialEntryListItem } from "@routiq/contracts";
import { StatusBadge } from "@/components/status-badge.js";
import { FinanceStatusBadge } from "@/finance/FinanceStatusBadge.js";
import { formatDate, formatMoney, localizedLabel } from "@/lib/format.js";

export type FinanceEntryColumnId =
  | "entryNumber"
  | "status"
  | "economicDate"
  | "category"
  | "amount"
  | "counterpartyName";

/**
 * One definition per column, shared by every screen that lists entries, so the
 * home screen and the entries list cannot drift on what a status chip or an
 * amount looks like.
 *
 * No column is sortable: the read is keyset-paginated on `postedAt` and takes
 * no `sort` param (apps/api/src/reads/finance.ts), so a header control could
 * only reorder the rows already loaded and would misrepresent the rest.
 */
function buildColumns(
  t: (key: string) => string,
): Record<FinanceEntryColumnId, ColumnDef<FinancialEntryListItem>> {
  return {
    entryNumber: {
      accessorKey: "entryNumber",
      header: t("finance.entries.detail.entryNumber"),
      meta: { mobile: "primary", label: t("finance.entries.detail.entryNumber") },
      cell: ({ row }) => (
        <span className="font-mono whitespace-nowrap">{row.original.entryNumber}</span>
      ),
    },
    status: {
      accessorKey: "status",
      header: t("finance.entries.detail.status"),
      meta: { mobile: "primary", label: t("finance.entries.detail.status") },
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-2">
          <FinanceStatusBadge status={row.original.status}>
            {t(`finance.entries.status.${row.original.status}`)}
          </FinanceStatusBadge>
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
      meta: { mobile: "secondary", label: t("finance.entries.detail.date") },
      cell: ({ row }) => formatDate(row.original.economicDate),
    },
    category: {
      id: "category",
      header: t("finance.entries.detail.category"),
      meta: { mobile: "primary", label: t("finance.entries.detail.category") },
      cell: ({ row }) => localizedLabel(row.original.category),
    },
    amount: {
      id: "amount",
      header: t("finance.entries.detail.amount"),
      meta: { mobile: "primary", label: t("finance.entries.detail.amount") },
      cell: ({ row }) => (
        <span className="text-right font-mono font-semibold whitespace-nowrap">
          {formatMoney(row.original.amountMinor, {
            currency: row.original.currency,
            signDisplay: "always",
          })}
        </span>
      ),
    },
    counterpartyName: {
      accessorKey: "counterpartyName",
      header: t("finance.entries.detail.counterparty"),
      meta: {
        mobile: "secondary",
        label: t("finance.entries.detail.counterparty"),
      },
      cell: ({ row }) => row.original.counterpartyName ?? "—",
    },
  };
}

/**
 * Columns in the requested order. Pass a module-level constant for `ids` — the
 * memo keys off its identity, and a literal rebuilt each render would defeat it.
 */
export function useFinanceEntryColumns(
  ids: readonly FinanceEntryColumnId[],
): ColumnDef<FinancialEntryListItem>[] {
  const { t, i18n } = useTranslation();

  return useMemo(() => {
    const columns = buildColumns(t);
    return ids.map((id) => columns[id]);
    // `t` is stable across a language change, so the language itself is the dep
    // that rebuilds the localized headers and cells.
  }, [ids, i18n.resolvedLanguage, t]);
}
