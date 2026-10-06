import { useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Building2, Check, ClipboardCheck, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import type { ColumnDef, SortingState, VisibilityState } from "@tanstack/react-table";
import { useMeContext } from "@/auth/me.js";
import {
  DataTable,
  DataTableViewOptions,
  type DataTableFilter,
  type DataTableFilterValues,
} from "@/components/data-table";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { StatusBadge } from "@/components/status-badge.js";
import { Button } from "@/components/ui/button";
import { FinanceToolbar } from "@/finance/FinanceToolbar.js";
import { EntryStatusBadge } from "@/finance/EntryStatusBadge.js";
import {
  EntryDecisionButtons,
  RejectEntryForm,
  useApproveEntry,
} from "@/finance/EntryDecisionForms.js";
import { EntrySummary } from "@/finance/EntrySummary.js";
import { amountKind, isOwnSubmission } from "@/finance/model.js";
import { canApproveEntries } from "@/finance/permissions.js";
import {
  approvalsOutsideBranch,
  approvalsTotal,
  useApprovals,
} from "@/finance/useApprovals.js";
import { toSortParam } from "@/lib/sort-param.js";
import { useAmbientBranchId, useCurrentBranch } from "@/shell/branch-context.js";
import { BranchScopeLine } from "@/shell/BranchScopeNotices.js";
import { formatDate, formatMoney, localizedLabel } from "@/lib/format.js";
import type { PendingApprovalItem } from "@routiq/contracts";

/** Only Reject asks anything first; Approve is one tap. */
type RejectDialogState = { open: false } | { open: true; entryId: string; rowVersion: number };

/** Mirrors the read's own default — oldest first is the queue's honest order. */
const DEFAULT_SORTING: SortingState = [{ id: "submittedAt", desc: false }];

/** The queue's fixed page size (apps/api/src/reads/finance.ts). */
const APPROVALS_PAGE_SIZE = 100;

export function FinanceApprovalsScreen() {
  const { t, i18n } = useTranslation();
  const label = useCommandLabel();
  const navigate = useNavigate();
  const me = useMeContext();
  const canApprove = canApproveEntries(me?.role, me?.enabledModules);

  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const sort = toSortParam(sorting);
  // A decision queue spans every branch in scope; the shell's agency only
  // presets this filter, which stays visible and can be widened back to all of
  // them. `undefined` means "still following the shell".
  //
  // `?branch=all` arrives from an overflow line elsewhere in the app, which has
  // already told the operator how much sits outside the ambient agency: landing
  // them back on that same narrowing would answer the wrong question.
  const { branch: arrivingWidened } = useSearch({ from: "/app/finance/approvals" });
  const [branchOverride, setBranchOverride] = useState<string | undefined>(
    arrivingWidened === "all" ? "" : undefined,
  );
  const { options: branchOptions } = useCurrentBranch();
  const ambientBranchId = useAmbientBranchId();
  const branchId = branchOverride ?? ambientBranchId ?? "";
  const filterValues = useMemo<DataTableFilterValues>(
    () => (branchId === "" ? {} : { branchId }),
    [branchId],
  );
  const branchName = branchOptions.find((branch) => branch.id === branchId)?.name;
  // `sort` rides in the query key, so reordering starts a fresh cursor.
  const approvalsQuery = useApprovals(canApprove, {
    ...(branchId === "" ? {} : { branchId }),
    ...(sort ? { sort } : {}),
  });
  const pendingTotal = approvalsTotal(approvalsQuery.data);
  const pendingElsewhere = approvalsOutsideBranch(approvalsQuery.data);
  const [rejectDialog, setRejectDialog] = useState<RejectDialogState>({ open: false });
  const { approve } = useApproveEntry();
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const entries = approvalsQuery.data?.pages.flatMap((page) => page.entries) ?? [];

  const filters = useMemo<DataTableFilter[]>(
    () => [
      {
        columnId: "branchId",
        type: "select",
        placeholder: t("finance.approvals.filters.branch"),
        options: branchOptions.map((branch) => ({
          value: branch.id,
          label: branch.name,
        })),
      },
    ],
    [branchOptions, t],
  );

  // The read declares `sortFields`, so the sortable headers below drive it
  // rather than reordering the loaded page.
  const columns = useMemo<ColumnDef<PendingApprovalItem>[]>(
    () => [
      {
        accessorKey: "entryNumber",
        header: t("finance.entries.detail.entryNumber"),
        enableSorting: true,
        meta: { mobile: "primary", label: t("finance.entries.detail.entryNumber") },
        cell: ({ row }) => (
          <span className="font-mono whitespace-nowrap">
            {row.original.entryNumber}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: t("finance.entries.detail.status"),
        // A row that offers no decision says who makes it here, so hiding the
        // column would leave an empty ⋯ unexplained.
        enableHiding: false,
        meta: { mobile: "primary", label: t("finance.entries.detail.status") },
        cell: ({ row }) => {
          const decider = isOwnSubmission(
            row.original.submittedByPrincipalId,
            me?.principalId,
          )
            ? t("finance.approvals.makerGuard")
            : row.original.directionDecides
              ? t("finance.approvals.directionDecides")
              : null;
          return (
            <span className="flex flex-col items-start gap-1">
              <EntryStatusBadge status={row.original.status} />
              {/* Wraps at the badge's width: its own column pushed the table
                  past a 1440 screen (#437). */}
              {decider !== null && (
                <span className="max-w-64 text-xs font-normal whitespace-normal text-muted-foreground">
                  {decider}
                </span>
              )}
            </span>
          );
        },
      },
      {
        accessorKey: "economicDate",
        header: t("finance.entries.detail.date"),
        enableSorting: false,
        meta: { mobile: "secondary", label: t("finance.entries.detail.date") },
        cell: ({ row }) => formatDate(row.original.economicDate),
      },
      {
        accessorKey: "submittedAt",
        header: t("finance.approvals.columns.submittedAt"),
        enableSorting: true,
        // A phone row shows values without headings, so a second bare date
        // there would read as the economic one.
        meta: { mobile: "hidden", label: t("finance.approvals.columns.submittedAt") },
        cell: ({ row }) => formatDate(row.original.submittedAt),
      },
      {
        // The queue spans branches by default, so each row has to say which one
        // it came from or an approver cannot tell them apart.
        id: "branch",
        header: t("finance.approvals.columns.branch"),
        enableSorting: false,
        meta: { mobile: "secondary", label: t("finance.approvals.columns.branch") },
        cell: ({ row }) => (
          <StatusBadge tone="neutral" icon={Building2}>
            {branchOptions.find((branch) => branch.id === row.original.branchId)
              ?.name ?? "—"}
          </StatusBadge>
        ),
      },
      {
        id: "category",
        header: t("finance.entries.detail.category"),
        meta: { mobile: "primary", label: t("finance.entries.detail.category") },
        cell: ({ row }) =>
          localizedLabel(row.original.category),
      },
      {
        id: "amount",
        // TanStack refuses to sort a display column, so the accessor is what
        // makes the header interactive; the id stays the read's field name.
        accessorKey: "amountMinor",
        header: t("finance.entries.detail.amount"),
        enableSorting: true,
        meta: { mobile: "primary", label: t("finance.entries.detail.amount") },
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="whitespace-nowrap font-mono font-semibold">
              {formatMoney(row.original.amountMinor, {
                currency: row.original.currency,
                sign: { context: "record" },
              })}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("finance.entries.detail.amountKind", { kind: amountKind(row.original) })}
            </span>
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
    [branchOptions, i18n.resolvedLanguage, me?.principalId, t],
  );

  // role-config: deciding is an approver's call, never on your own submission
  // (the maker guard the server also enforces), and never above the viewer's
  // approval band, where the server would answer APPROVAL_REQUIRED.
  const canDecide = (entry: PendingApprovalItem) =>
    canApprove &&
    !isOwnSubmission(entry.submittedByPrincipalId, me?.principalId) &&
    !entry.directionDecides;

  const openReject = (entry: PendingApprovalItem) =>
    setRejectDialog({ open: true, entryId: entry.id, rowVersion: entry.rowVersion });

  const rowActions = (entry: PendingApprovalItem) => {
    if (!canDecide(entry)) return [];

    return [
      {
        key: "approve",
        label: label("approve-entry"),
        icon: Check,
        onSelect: () => void approve({ id: entry.id, rowVersion: entry.rowVersion }),
      },
      {
        key: "reject",
        label: label("reject-entry"),
        icon: X,
        destructive: true,
        onSelect: () => openReject(entry),
      },
    ];
  };

  if (me !== undefined && !canApprove) {
    return (
      <PermissionDenied
        width="wide"
        title={t("finance.approvals.title")}
        icon={<ClipboardCheck className="size-7" aria-hidden />}
        code={deniedCode(me.enabledModules.includes("FINANCE"))}
      />
    );
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title={t("finance.approvals.title")}
      />
      <FinanceToolbar>
        {!approvalsQuery.isError && (
          <DataTableViewOptions
            columns={columns}
            value={columnVisibility}
            onChange={setColumnVisibility}
            primaryColumn={{ columnId: "entryNumber" }}
          />
        )}
      </FinanceToolbar>

      {branchName !== undefined && !approvalsQuery.isPending && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <BranchScopeLine branch={branchName} count={pendingTotal} />
          {/* A filtered queue is not the whole queue: the work it leaves out
              is named here, and the same line widens back to every branch. */}
          {pendingElsewhere > 0 && (
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-sm"
              onClick={() => setBranchOverride("")}
            >
              {t("finance.approvals.outsideBranch", { count: pendingElsewhere })}
            </Button>
          )}
        </div>
      )}

      {approvalsQuery.isError ? (
        <ErrorState
          className="mt-6"
          message={t("finance.approvals.loadFailed")}
          retryLabel={t("finance.approvals.retry")}
          onRetry={() => void approvalsQuery.refetch()}
        />
      ) : (
        <div className="mt-6">
          {/* Changing the branch filter starts a new query, so the queue reports
              `isPending` again. The table renders through it: a full-page loader
              would take the filter away from the approver mid-refinement. */}
          <DataTable
            columns={columns}
            data={entries}
            getRowId={(entry) => entry.id}
            filters={filters}
            filterValues={filterValues}
            onFilterChange={(values) => setBranchOverride(values["branchId"] ?? "")}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            sorting={sorting}
            onSortingChange={setSorting}
            primaryColumn={{ columnId: "entryNumber" }}
            rowActions={rowActions}
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
              actions: (entry, drawer) =>
                canDecide(entry) ? (
                  <EntryDecisionButtons
                    entry={{ id: entry.id, rowVersion: entry.rowVersion }}
                    onApproved={drawer.close}
                    onReject={() => {
                      drawer.close();
                      openReject(entry);
                    }}
                  />
                ) : null,
            }}
            loadMore={{
              hasNextPage: approvalsQuery.hasNextPage,
              isFetching: approvalsQuery.isFetchingNextPage,
              onLoadMore: () => void approvalsQuery.fetchNextPage(),
              pageSize: APPROVALS_PAGE_SIZE,
            }}
            emptyState={
              approvalsQuery.isPending ? (
                <LoadingState label={t("finance.approvals.loading")} />
              ) : (
                <EmptyState
                  icon={<ClipboardCheck className="size-7" aria-hidden />}
                  message={
                    branchName === undefined
                      ? t("finance.approvals.empty")
                      : t("finance.approvals.branchEmpty", { branch: branchName })
                  }
                  action={
                    // Nothing pending here says nothing about the other
                    // branches, and the queue is where that has to be reachable.
                    branchName === undefined
                      ? undefined
                      : {
                          label: t("finance.approvals.filters.allBranches"),
                          onClick: () => setBranchOverride(""),
                        }
                  }
                />
              )
            }
          />
        </div>
      )}

      {rejectDialog.open && (
        <RejectEntryForm
          surface="dialog"
          entry={{ id: rejectDialog.entryId, rowVersion: rejectDialog.rowVersion }}
          onDismiss={() => setRejectDialog({ open: false })}
        />
      )}
    </PageContainer>
  );
}
