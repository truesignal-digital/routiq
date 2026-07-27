import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { VisibilityState } from "@tanstack/react-table";
import { FileText, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DataTable,
  DataTableViewOptions,
  type DataTableFilter,
  type DataTableFilterOption,
  type DataTableFilterValues,
} from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { useMeContext } from "@/auth/me.js";
import { assetDisplayName } from "@/assets/model.js";
import { useAssets } from "@/assets/useAssets.js";
import { EntrySummary } from "@/finance/EntrySummary.js";
import { FinanceToolbar } from "@/finance/FinanceToolbar.js";
import { canRecordFinance } from "@/finance/permissions.js";
import {
  useFinanceEntryColumns,
  type FinanceEntryColumnId,
} from "@/finance/entryColumns.js";
import { useEntries } from "@/finance/useEntries.js";
import { formatDate } from "@/lib/format.js";

const STATUS_OPTIONS = ["SUBMITTED", "POSTED", "REJECTED", "REVERSED"] as const;

/** Module-level so the column memo in `useFinanceEntryColumns` holds. */
const LIST_COLUMNS: readonly FinanceEntryColumnId[] = [
  "status",
  "economicDate",
  "category",
  "amount",
  "counterpartyName",
];

export function FinanceEntriesScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMeContext();
  const canView = canRecordFinance(me?.role, me?.enabledModules);

  // Toolbar state keyed by the `useEntries` param it drives. `/v1/finance/entries`
  // does the filtering, so the table never narrows rows itself.
  const [filterValues, setFilterValues] = useState<DataTableFilterValues>({});
  // Owned here so the view menu can sit in the toolbar row beside the tabs.
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
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

  const columns = useFinanceEntryColumns(LIST_COLUMNS);

  if (me !== undefined && !canView) {
    return (
      <PermissionDenied
        width="wide"
        title={t("finance.entries.title")}
        icon={<FileText className="size-7" aria-hidden />}
        code={deniedCode(me.enabledModules.includes("FINANCE"))}
      />
    );
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title={t("finance.entries.title")}
        onBack={() => void navigate({ to: "/assets" })}
        backLabel={t("finance.entries.back")}
      />
      <FinanceToolbar>
        <DataTableViewOptions
          columns={columns}
          value={columnVisibility}
          onChange={setColumnVisibility}
        />
        {canView && (
          <Button size="sm" render={<Link to="/finance/record" />}>
            <Plus aria-hidden />
            {t("finance.entries.recordAction")}
          </Button>
        )}
      </FinanceToolbar>

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
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
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
