import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { useMeContext } from "../auth/me.js";
import { errorMessage } from "../lib/error-message.js";
import { useEntries } from "../finance/useEntries.js";
import { canRecordFinance } from "../finance/permissions.js";
import { FinanceNav } from "../finance/FinanceNav.js";
import type { FinancialEntryListItem } from "@routiq/contracts";

const statusStyles: Record<string, string> = {
  SUBMITTED: "bg-amber-100 text-amber-900 ring-amber-200",
  POSTED: "bg-emerald-100 text-emerald-900 ring-emerald-200",
  REJECTED: "bg-red-100 text-red-900 ring-red-200",
  REVERSED: "bg-slate-100 text-slate-900 ring-slate-200",
};

const STATUS_OPTIONS = ["SUBMITTED", "POSTED", "REJECTED", "REVERSED"] as const;

export function FinanceEntriesScreen() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const me = useMeContext();
  const canView = canRecordFinance(me?.role, me?.enabledModules);

  const [status, setStatus] = useState<string>("");
  const [periodCode, setPeriodCode] = useState<string>("");
  const [assetId, setAssetId] = useState<string>("");

  const entriesQuery = useEntries({
    ...(status ? { status } : {}),
    ...(periodCode ? { periodCode } : {}),
    ...(assetId ? { assetId } : {}),
  });

  const allEntries = entriesQuery.data?.pages.flatMap((page) => page.entries) ?? [];
  const columns = useMemo<ColumnDef<FinancialEntryListItem>[]>(
    () => [
      {
        accessorKey: "status",
        header: t("finance.entries.detail.status"),
        meta: { mobile: "primary" },
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex min-h-6 items-center rounded-full px-2 text-[0.65rem] font-bold uppercase ring-1 ring-inset ${
                statusStyles[row.original.status]
              }`}
            >
              {t(`finance.entries.status.${row.original.status}`)}
            </span>
            {row.original.isLatePosting && (
              <span className="text-[0.65rem] font-bold uppercase text-amber-900">
                {t("finance.entries.detail.latePosting")}
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "economicDate",
        header: t("finance.entries.detail.date"),
        meta: { mobile: "secondary" },
      },
      {
        id: "category",
        header: t("finance.entries.detail.category"),
        meta: { mobile: "primary" },
        cell: ({ row }) =>
          i18n.resolvedLanguage === "en"
            ? row.original.category.labelEn
            : row.original.category.labelFr,
      },
      {
        id: "amount",
        header: t("finance.entries.detail.amount"),
        meta: { mobile: "primary" },
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-right font-semibold">
            {formatAmount(row.original.amountMinor, true)} {row.original.currency}
          </span>
        ),
      },
      {
        accessorKey: "counterpartyName",
        header: t("finance.entries.detail.counterparty"),
        meta: { mobile: "secondary" },
        cell: ({ row }) => row.original.counterpartyName ?? "—",
      },
    ],
    [i18n.resolvedLanguage, t],
  );

  if (me !== undefined && !canView) {
    return (
      <section className="mx-auto w-full max-w-4xl px-4 py-6">
        <h1 className="text-2xl font-semibold">{t("finance.entries.title")}</h1>
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {errorMessage(i18n, "MODULE_DISABLED")}
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-6">
      <button
        type="button"
        className="flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground"
        onClick={() => void navigate({ to: "/assets" })}
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("finance.entries.back")}
      </button>
      <h1 className="mt-2 text-2xl font-semibold">{t("finance.entries.title")}</h1>
      <FinanceNav />

      {/* Filters */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="status-filter" className="text-xs font-semibold uppercase text-muted-foreground">
            {t("finance.entries.filters.status")}
          </label>
          <select
            id="status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="min-h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">{t("finance.entries.filters.allStatuses")}</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`finance.entries.status.${s}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="period-filter" className="text-xs font-semibold uppercase text-muted-foreground">
            {t("finance.entries.filters.period")}
          </label>
          <input
            id="period-filter"
            type="text"
            placeholder={t("finance.entries.filters.periodPlaceholder")}
            value={periodCode}
            onChange={(e) => setPeriodCode(e.target.value)}
            className="min-h-9 rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="asset-filter" className="text-xs font-semibold uppercase text-muted-foreground">
            {t("finance.entries.filters.asset")}
          </label>
          <input
            id="asset-filter"
            type="text"
            placeholder={t("finance.entries.filters.assetPlaceholder")}
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            className="min-h-9 rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {entriesQuery.isPending ? (
        <p className="mt-6 text-sm text-muted-foreground">{t("finance.entries.loading")}</p>
      ) : entriesQuery.isError ? (
        <div role="alert" className="mt-6 flex flex-col gap-3">
          <p className="text-sm text-destructive">{t("finance.entries.loadFailed")}</p>
          <Button
            variant="outline"
            className="min-h-11 self-start"
            onClick={() => void entriesQuery.refetch()}
          >
            {t("finance.entries.retry")}
          </Button>
        </div>
      ) : (
        <div className="mt-6">
          <DataTable
            columns={columns}
            data={allEntries}
            onRowClick={(entry) =>
              void navigate({
                to: "/finance/entries/$entryId",
                params: { entryId: entry.id },
              })
            }
            loadMore={{
              hasNextPage: entriesQuery.hasNextPage,
              isFetching: entriesQuery.isFetchingNextPage,
              onLoadMore: () => void entriesQuery.fetchNextPage(),
            }}
            emptyState={
              <p className="text-sm text-muted-foreground">{t("finance.entries.empty")}</p>
            }
          />
        </div>
      )}
    </section>
  );
}

function formatAmount(minor: number, signDisplay = false) {
  return new Intl.NumberFormat("fr-CM", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    ...(signDisplay ? { signDisplay: "always" as const } : {}),
  }).format(minor);
}
