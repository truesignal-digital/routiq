import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Building2, ClipboardCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import type { SortingState, VisibilityState } from "@tanstack/react-table";
import { useMeContext } from "@/auth/me.js";
import {
  DataTable,
  type DataTableFilter,
  type DataTableFilterValues,
  type DataTableColumn,
} from "@/components/data-table";
import { EmptyState, ErrorState, LoadingState } from "@/components/page";
import { StatusBadge } from "@/components/status-badge.js";
import { Button } from "@/components/ui/button";
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
type RejectDialogState = { open: false } | { open: true; entry: PendingApprovalItem };

/** Mirrors the read's own default — oldest first is the queue's honest order. */
const DEFAULT_SORTING: SortingState = [{ id: "submittedAt", desc: false }];

/** The queue's fixed page size (apps/api/src/reads/finance.ts). */
const APPROVALS_PAGE_SIZE = 100;

/**
 * The Money page's "Waiting your approval" view (#314): the entries this
 * viewer may decide, oldest first, with Reject and Approve on each row. It
 * replaced the separate Approvals page; `/finance/approvals` redirects here.
 */
export function WaitingApprovals({ arrivingWidened = false }: { arrivingWidened?: boolean }) {
  const { t, i18n } = useTranslation();
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
  const [branchOverride, setBranchOverride] = useState<string | undefined>(
    arrivingWidened ? "" : undefined,
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
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  // role-config: deciding is an approver's call, never on your own submission
  // (the maker guard the server also enforces), and never above the viewer's
  // approval band, where the server would answer APPROVAL_REQUIRED. Those rows
  // are not this viewer's work, so the view leaves them out; the entries list
  // still shows them as waiting.
  const canDecide = (entry: PendingApprovalItem) =>
    canApprove &&
    !isOwnSubmission(entry.submittedByPrincipalId, me?.principalId) &&
    !entry.directionDecides;

  const entries = (approvalsQuery.data?.pages.flatMap((page) => page.entries) ?? []).filter(
    canDecide,
  );

  const openReject = (entry: PendingApprovalItem) =>
    setRejectDialog({ open: true, entry });

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
  const columns = useMemo<DataTableColumn<PendingApprovalItem>[]>(
    () => [
      {
        accessorKey: "entryNumber",
        header: t("finance.entries.detail.entryNumber"),
        enableSorting: true,
        meta: { phone: "title", label: t("finance.entries.detail.entryNumber") },
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {row.original.entryNumber}
          </span>
        ),
      },
      {
        accessorKey: "economicDate",
        header: t("finance.entries.detail.date"),
        enableSorting: false,
        meta: { phone: "meta", label: t("finance.entries.detail.date") },
        cell: ({ row }) => formatDate(row.original.economicDate),
      },
      {
        accessorKey: "submittedAt",
        header: t("finance.approvals.columns.submittedAt"),
        enableSorting: true,
        // A phone row shows values without headings, so a second bare date
        // there would read as the economic one.
        meta: { phone: "hidden", label: t("finance.approvals.columns.submittedAt") },
        cell: ({ row }) => formatDate(row.original.submittedAt),
      },
      {
        // The queue spans branches by default, so each row has to say which one
        // it came from or an approver cannot tell them apart.
        id: "branch",
        header: t("finance.approvals.columns.branch"),
        enableSorting: false,
        meta: {
          phone: "meta",
          label: t("finance.approvals.columns.branch"),
          phoneText: (item) =>
            branchOptions.find((branch) => branch.id === item.branchId)?.name ?? null,
        },
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
        meta: { phone: "meta", label: t("finance.entries.detail.category") },
        cell: ({ row }) => (
          <span className="whitespace-normal">
            {localizedLabel(row.original.category)}
            {/* What is missing, said on the row, so the approver need not
                open it to know. A reversal never needs paperwork. */}
            {row.original.evidence?.state === "NOT_SUPPLIED" &&
              row.original.reversesEntryId === null && (
                <span data-slot="missing-receipt" className="text-destructive">
                  {" · "}
                  {t("finance.approvals.noReceipt")}
                </span>
              )}
          </span>
        ),
      },
      {
        id: "amount",
        // TanStack refuses to sort a display column, so the accessor is what
        // makes the header interactive; the id stays the read's field name.
        accessorKey: "amountMinor",
        header: t("finance.entries.detail.amount"),
        enableSorting: true,
        meta: {
          phone: "value",
          label: t("finance.entries.detail.amount"),
          phoneText: (item) =>
            formatMoney(item.amountMinor, {
              currency: item.currency,
              sign: { context: "record" },
            }),
        },
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-semibold whitespace-nowrap tabular-nums">
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
          phone: "meta",
          label: t("finance.entries.detail.counterparty"),
        },
        cell: ({ row }) => (
          <span className="whitespace-normal">{row.original.counterpartyName ?? "—"}</span>
        ),
      },
      {
        id: "decision",
        header: () => <span className="sr-only">{t("finance.approvals.columns.decision")}</span>,
        enableHiding: false,
        enableSorting: false,
        // On a phone the buttons sit under the amount, each a 44 px target.
        meta: { phone: "status", label: t("finance.approvals.columns.decision") },
        cell: ({ row }) => (
          <RowDecision entry={row.original} onReject={() => openReject(row.original)} />
        ),
      },
    ],
    [branchOptions, i18n.resolvedLanguage, t],
  );

  if (approvalsQuery.isError) {
    return (
      <ErrorState
        className="mt-6"
        message={t("finance.approvals.loadFailed")}
        retryLabel={t("finance.approvals.retry")}
        onRetry={() => void approvalsQuery.refetch()}
      />
    );
  }

  return (
    <>
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

      {rejectDialog.open && (
        <RejectEntryForm
          surface="dialog"
          entry={rejectDialog.entry}
          onDismiss={() => setRejectDialog({ open: false })}
        />
      )}
    </>
  );
}

/** Reject opens the reason dialog; Approve commits on the spot and comes last. */
function RowDecision({
  entry,
  onReject,
}: {
  entry: PendingApprovalItem;
  onReject: () => void;
}) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const { approve, submitting } = useApproveEntry();

  return (
    // Wraps on a phone, where the row's end column has half the width: the
    // two buttons stack instead of spilling over the entry number.
    <span className="flex flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="desktop-sm"
        disabled={submitting}
        aria-label={t("finance.approvals.decideRow", { action: label("reject-entry"), number: entry.entryNumber })}
        onClick={onReject}
      >
        {label("reject-entry")}
      </Button>
      <Button
        type="button"
        size="desktop-sm"
        disabled={submitting}
        aria-label={t("finance.approvals.decideRow", { action: label("approve-entry"), number: entry.entryNumber })}
        onClick={() => void approve({ id: entry.id, rowVersion: entry.rowVersion })}
      >
        {label("approve-entry", submitting ? "submitting" : "label")}
      </Button>
    </span>
  );
}
