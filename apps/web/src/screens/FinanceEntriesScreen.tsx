import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DataTable,
  type DataTableFilter,
  type DataTableFilterOption,
  type DataTableFilterValues,
} from "@/components/data-table";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { StatusBadge } from "@/components/status-badge.js";
import { useMeContext } from "@/auth/me.js";
import { assetDisplayName } from "@/assets/model.js";
import { useAssets } from "@/assets/useAssets.js";
import { EntrySummary } from "@/finance/EntrySummary.js";
import { FinanceNav } from "@/finance/FinanceNav.js";
import { canRecordFinance } from "@/finance/permissions.js";
import { FinanceStatusBadge } from "@/finance/FinanceStatusBadge.js";
import { useEntries } from "@/finance/useEntries.js";
import { errorMessage } from "@/lib/error-message.js";
import { formatMoney, formatDate, localizedLabel } from "@/lib/format.js";
import type { FinancialEntryListItem } from "@routiq/contracts";

const STATUS_OPTIONS = ["SUBMITTED", "POSTED", "REJECTED", "REVERSED"] as const;

export function FinanceEntriesScreen() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const me = useMeContext();
  const canView = canRecordFinance(me?.role, me?.enabledModules);

  // Toolbar state keyed by the `useEntries` param it drives. `/v1/finance/entries`
  // does the filtering, so the table never narrows rows itself.
  const [filterValues, setFilterValues] = useState<DataTableFilterValues>({});
  const periodCode = filterValues["periodCode"]?.trim() ?? "";

  const entriesQuery = useEntries({
    ...(filterValues["status"] ? { status: filterValues["status"] } : {}),
    ...(periodCode ? { periodCode } : {}),
    ...(filterValues["assetId"] ? { assetId: filterValues["assetId"] } : {}),
  });

  const assetsQuery = useAssets();
  const {
    hasNextPage: hasMoreAssets,
    isFetchingNextPage: isFetchingMoreAssets,
    fetchNextPage: fetchMoreAssets,
  } = assetsQuery;

  // The asset filter has to offer the whole fleet: stopping at the first keyset
  // page would silently drop assets an operator needs to filter by. Pilot fleets
  // are tens of rows, so draining the cursor costs a request or two.
  useEffect(() => {
    if (hasMoreAssets && !isFetchingMoreAssets) {
      void fetchMoreAssets();
    }
  }, [hasMoreAssets, isFetchingMoreAssets, fetchMoreAssets]);

  const assetOptions = useMemo<DataTableFilterOption[]>(
    () =>
      (assetsQuery.data?.pages.flatMap((page) => page.items) ?? []).map((asset) => {
        const name = assetDisplayName(asset);
        return {
          value: asset.id,
          label:
            name === asset.assetCode
              ? asset.assetCode
              : t("finance.entries.filters.assetOption", {
                  code: asset.assetCode,
                  name,
                }),
        };
      }),
    [assetsQuery.data, t],
  );

  const filters = useMemo<DataTableFilter[]>(
    () => [
      {
        columnId: "status",
        type: "select",
        placeholder: t("finance.entries.filters.status"),
        options: STATUS_OPTIONS.map((status) => ({
          value: status,
          label: t(`finance.entries.status.${status}`),
        })),
      },
      {
        columnId: "periodCode",
        type: "search",
        placeholder: t("finance.entries.filters.periodPlaceholder"),
      },
      {
        columnId: "assetId",
        type: "select",
        placeholder: t("finance.entries.filters.asset"),
        options: assetOptions,
      },
    ],
    [assetOptions, t],
  );

  const allEntries = entriesQuery.data?.pages.flatMap((page) => page.entries) ?? [];

  // No column is sortable. The read is keyset-paginated on `postedAt` and takes
  // no `sort` param (apps/api/src/reads/finance.ts), so a header control could
  // only reorder the pages already loaded and would misrepresent the rest.
  const columns = useMemo<ColumnDef<FinancialEntryListItem>[]>(
    () => [
      {
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
      {
        accessorKey: "economicDate",
        header: t("finance.entries.detail.date"),
        meta: { mobile: "secondary", label: t("finance.entries.detail.date") },
        cell: ({ row }) => formatDate(row.original.economicDate),
      },
      {
        id: "category",
        header: t("finance.entries.detail.category"),
        meta: { mobile: "primary", label: t("finance.entries.detail.category") },
        cell: ({ row }) => localizedLabel(row.original.category),
      },
      {
        id: "amount",
        header: t("finance.entries.detail.amount"),
        meta: { mobile: "primary", label: t("finance.entries.detail.amount") },
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-right font-semibold">
            {formatMoney(row.original.amountMinor, {
              currency: row.original.currency,
              signDisplay: "always",
            })}
          </span>
        ),
      },
      {
        accessorKey: "counterpartyName",
        header: t("finance.entries.detail.counterparty"),
        meta: {
          mobile: "secondary",
          label: t("finance.entries.detail.counterparty"),
        },
        cell: ({ row }) => row.original.counterpartyName ?? "—",
      },
    ],
    [i18n.resolvedLanguage, t],
  );

  if (me !== undefined && !canView) {
    return (
      <PageContainer width="wide">
        <PageHeader title={t("finance.entries.title")} />
        <EmptyState
          className="mt-6"
          icon={<FileText className="size-7" aria-hidden />}
          message={errorMessage(i18n, "MODULE_DISABLED")}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title={t("finance.entries.title")}
        onBack={() => void navigate({ to: "/assets" })}
        backLabel={t("finance.entries.back")}
      />
      <FinanceNav />

      {entriesQuery.isError ? (
        <ErrorState
          className="mt-6"
          message={t("finance.entries.loadFailed")}
          retryLabel={t("finance.entries.retry")}
          onRetry={() => void entriesQuery.refetch()}
        />
      ) : (
        <div className="mt-6">
          {/* Each filter change is a new query key, so the fetch reports
              `isPending`. Rendering the table through it keeps the toolbar
              mounted — replacing it with a full-page loader would yank the
              controls out from under the operator mid-refinement. */}
          <DataTable
            columns={columns}
            data={allEntries}
            filters={filters}
            filterValues={filterValues}
            onFilterChange={setFilterValues}
            enableColumnVisibility
            rowViewer={{
              title: (entry) => entry.entryNumber,
              description: (entry) =>
                t("finance.entries.viewer.description", {
                  date: formatDate(entry.economicDate),
                }),
              render: (entry) => <EntrySummary entryId={entry.id} />,
              fullScreen: {
                label: t("finance.entries.viewer.fullScreen"),
                onOpen: (entry) =>
                  void navigate({
                    to: "/finance/entries/$entryId",
                    params: { entryId: entry.id },
                  }),
              },
            }}
            loadMore={{
              hasNextPage: entriesQuery.hasNextPage,
              isFetching: entriesQuery.isFetchingNextPage,
              onLoadMore: () => void entriesQuery.fetchNextPage(),
            }}
            emptyState={
              entriesQuery.isPending ? (
                <LoadingState label={t("finance.entries.loading")} />
              ) : (
                <EmptyState
                  icon={<FileText className="size-7" aria-hidden />}
                  message={t("finance.entries.empty")}
                />
              )
            }
          />
        </div>
      )}
    </PageContainer>
  );
}
