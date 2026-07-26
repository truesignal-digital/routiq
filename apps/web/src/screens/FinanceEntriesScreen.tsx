import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DataTable } from "@/components/data-table";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { useMeContext } from "../auth/me.js";
import { errorMessage } from "../lib/error-message.js";
import { useEntries } from "../finance/useEntries.js";
import { canRecordFinance } from "../finance/permissions.js";
import { FinanceNav } from "../finance/FinanceNav.js";
import { FinanceStatusBadge } from "../finance/FinanceStatusBadge.js";
import type { FinancialEntryListItem } from "@routiq/contracts";

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
            <FinanceStatusBadge status={row.original.status}>
              {t(`finance.entries.status.${row.original.status}`)}
            </FinanceStatusBadge>
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
        <PageHeader title={t("finance.entries.title")} />
        <EmptyState
          className="mt-6"
          icon={<FileText className="size-7" aria-hidden />}
          message={errorMessage(i18n, "MODULE_DISABLED")}
        />
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-6">
      <PageHeader
        title={t("finance.entries.title")}
        onBack={() => void navigate({ to: "/assets" })}
        backLabel={t("finance.entries.back")}
      />
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
        <LoadingState className="mt-6" label={t("finance.entries.loading")} />
      ) : entriesQuery.isError ? (
        <ErrorState
          className="mt-6"
          message={t("finance.entries.loadFailed")}
          retryLabel={t("finance.entries.retry")}
          onRetry={() => void entriesQuery.refetch()}
        />
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
              <EmptyState
                icon={<FileText className="size-7" aria-hidden />}
                message={t("finance.entries.empty")}
              />
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
