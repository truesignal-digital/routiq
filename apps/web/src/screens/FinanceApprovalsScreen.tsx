import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardCheck, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ColumnDef, SortingState, VisibilityState } from "@tanstack/react-table";
import { z } from "zod";
import { useMeContext } from "@/auth/me.js";
import { useActiveSession } from "@/auth/store.js";
import { commandClient } from "@/commands/instance.js";
import { createCommandIntent, type CommandIntent } from "@/commands/intent.js";
import { DataTable, DataTableViewOptions } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner.js";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { StatusBadge } from "@/components/status-badge.js";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FinanceToolbar } from "@/finance/FinanceToolbar.js";
import { FinanceStatusBadge } from "@/finance/FinanceStatusBadge.js";
import { isOwnSubmission, validateRejectionReason } from "@/finance/model.js";
import { canApproveEntries } from "@/finance/permissions.js";
import { useApprovals } from "@/finance/useApprovals.js";
import { toSortParam } from "@/lib/sort-param.js";
import { formatDate, formatMoney, localizedLabel } from "@/lib/format.js";
import { notifyCommandSuccess } from "@/lib/notify.js";
import {
  approveEntryPayload,
  rejectEntryPayload,
  type PendingApprovalItem,
} from "@routiq/contracts";

type ApproveEntryPayloadType = z.infer<typeof approveEntryPayload>;
type RejectEntryPayloadType = z.infer<typeof rejectEntryPayload>;

type ActionDialogState =
  | { open: false }
  | { open: true; entryId: string; action: "approve" | "reject"; rowVersion: number };

/** Mirrors the read's own default — oldest first is the queue's honest order. */
const DEFAULT_SORTING: SortingState = [{ id: "submittedAt", desc: false }];

/** The queue's fixed page size (apps/api/src/reads/finance.ts). */
const APPROVALS_PAGE_SIZE = 100;

export function FinanceApprovalsScreen() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const session = useActiveSession();
  const me = useMeContext();
  const canApprove = canApproveEntries(me?.role, me?.enabledModules);

  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const sort = toSortParam(sorting);
  // `sort` rides in the query key, so reordering starts a fresh cursor.
  const approvalsQuery = useApprovals(canApprove, sort ? { sort } : {});
  const [actionDialog, setActionDialog] = useState<ActionDialogState>({ open: false });
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const approveIntentRef = useRef<CommandIntent<ApproveEntryPayloadType> | undefined>(undefined);
  const rejectIntentRef = useRef<CommandIntent<RejectEntryPayloadType> | undefined>(undefined);
  const [actionError, setActionError] = useState<string>();

  const entries = approvalsQuery.data?.pages.flatMap((page) => page.entries) ?? [];

  // ADR-0001: a decided entry leaves the queue because the server says so, not
  // because the client crossed it off locally.
  const invalidateDecided = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["ws", session?.workspaceSlug, "finance", "approvals"],
    });
    await queryClient.invalidateQueries({
      queryKey: ["ws", session?.workspaceSlug, "finance", "entries"],
    });
  };
  // The queue takes no filters, but it does declare `sortFields`, so the
  // sortable headers below drive the read rather than the loaded page.
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
        meta: { mobile: "primary", label: t("finance.entries.detail.status") },
        cell: ({ row }) => (
          <FinanceStatusBadge status={row.original.status}>
            {t(`finance.entries.status.${row.original.status}`)}
          </FinanceStatusBadge>
        ),
      },
      {
        accessorKey: "submittedAt",
        header: t("finance.entries.detail.date"),
        enableSorting: true,
        meta: { mobile: "secondary", label: t("finance.entries.detail.date") },
        cell: ({ row }) => formatDate(row.original.submittedAt),
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
          <span className="whitespace-nowrap font-mono font-semibold">
            {formatMoney(row.original.amountMinor, { currency: row.original.currency, signDisplay: "never" })}
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
      {
        id: "guard",
        header: t("finance.approvals.columns.actions"),
        enableSorting: false,
        // The decisions moved to the row's ⋯ menu; this column only explains
        // the rows that offer none.
        enableHiding: false,
        meta: {
          mobile: "primary",
          label: t("finance.approvals.columns.actions"),
        },
        cell: ({ row }) =>
          isOwnSubmission(row.original.submittedByPrincipalId, me?.principalId) ? (
            <StatusBadge tone="warning">
              {t("finance.approvals.makerGuard")}
            </StatusBadge>
          ) : null,
      },
    ],
    [i18n.resolvedLanguage, me?.principalId, t],
  );

  const rowActions = (entry: PendingApprovalItem) => {
    // role-config: deciding is an approver's call, and never on your own
    // submission — the maker guard the server also enforces.
    if (!canApprove) return [];
    if (isOwnSubmission(entry.submittedByPrincipalId, me?.principalId)) return [];

    return [
      {
        key: "approve",
        label: t("finance.approvals.approve"),
        icon: Check,
        onSelect: () =>
          setActionDialog({
            open: true,
            entryId: entry.id,
            action: "approve" as const,
            rowVersion: entry.rowVersion,
          }),
      },
      {
        key: "reject",
        label: t("finance.approvals.reject"),
        icon: X,
        destructive: true,
        onSelect: () =>
          setActionDialog({
            open: true,
            entryId: entry.id,
            action: "reject" as const,
            rowVersion: entry.rowVersion,
          }),
      },
    ];
  };

  const handleApprove = async (entryId: string, rowVersion: number, note: string) => {
    setActionError(undefined);
    approveIntentRef.current ??= createCommandIntent<ApproveEntryPayloadType>(
      commandClient,
      "approve-entry",
      1,
    );

    const result = await approveIntentRef.current.submit(
      {
        entryId,
        ...(note ? { note } : {}),
      },
      { expectedVersion: rowVersion },
    );

    if (!result.ok) {
      if (result.code === "VERSION_CONFLICT") {
        // Refetch on version conflict
        await approvalsQuery.refetch();
        return;
      }
      setActionError(result.code);
      return;
    }

    notifyCommandSuccess("finance", "approved", result.outcome.warnings);
    setActionDialog({ open: false });
    await invalidateDecided();
  };

  const handleReject = async (entryId: string, rowVersion: number, reason: string) => {
    setActionError(undefined);
    rejectIntentRef.current ??= createCommandIntent<RejectEntryPayloadType>(
      commandClient,
      "reject-entry",
      1,
    );

    const result = await rejectIntentRef.current.submit(
      {
        entryId,
        reason,
      },
      { expectedVersion: rowVersion },
    );

    if (!result.ok) {
      if (result.code === "VERSION_CONFLICT") {
        await approvalsQuery.refetch();
        return;
      }
      setActionError(result.code);
      return;
    }

    notifyCommandSuccess("finance", "rejected", result.outcome.warnings);
    setActionDialog({ open: false });
    await invalidateDecided();
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
        {!approvalsQuery.isPending && !approvalsQuery.isError && (
          <DataTableViewOptions
            columns={columns}
            value={columnVisibility}
            onChange={setColumnVisibility}
            primaryColumn={{ columnId: "entryNumber" }}
          />
        )}
      </FinanceToolbar>

      {approvalsQuery.isPending ? (
        <LoadingState className="mt-6" label={t("finance.approvals.loading")} />
      ) : approvalsQuery.isError ? (
        <ErrorState
          className="mt-6"
          message={t("finance.approvals.loadFailed")}
          retryLabel={t("finance.approvals.retry")}
          onRetry={() => void approvalsQuery.refetch()}
        />
      ) : (
        <div className="mt-6">
          <DataTable
            columns={columns}
            data={entries}
            getRowId={(entry) => entry.id}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            sorting={sorting}
            onSortingChange={setSorting}
            primaryColumn={{ columnId: "entryNumber" }}
            rowActions={rowActions}
            loadMore={{
              hasNextPage: approvalsQuery.hasNextPage,
              isFetching: approvalsQuery.isFetchingNextPage,
              onLoadMore: () => void approvalsQuery.fetchNextPage(),
              pageSize: APPROVALS_PAGE_SIZE,
            }}
            emptyState={
              <EmptyState
                icon={<ClipboardCheck className="size-7" aria-hidden />}
                message={t("finance.approvals.empty")}
              />
            }
          />
        </div>
      )}

      {actionDialog.open && (
        <ActionDialog
          action={actionDialog.action}
          onApprove={(note) =>
            handleApprove(actionDialog.entryId, actionDialog.rowVersion, note)
          }
          onReject={(reason) =>
            handleReject(actionDialog.entryId, actionDialog.rowVersion, reason)
          }
          onCancel={() => setActionDialog({ open: false })}
          error={actionError}
        />
      )}
    </PageContainer>
  );
}


function ActionDialog({
  action,
  onApprove,
  onReject,
  onCancel,
  error,
}: {
  action: "approve" | "reject";
  onApprove: (note: string) => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  onCancel: () => void;
  error: string | undefined;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isValid = action === "approve" || validateRejectionReason(text);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (action === "approve") {
        await onApprove(text);
      } else {
        await onReject(text);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {action === "approve"
              ? t("finance.approvals.approveTitle")
              : t("finance.approvals.rejectTitle")}
          </DialogTitle>
        </DialogHeader>

        {error && <ErrorBanner code={error} />}

        {action === "approve" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="note">{t("finance.approvals.noteLabel")} {t("finance.approvals.optional")}</Label>
            <Textarea id="note" placeholder={t("finance.approvals.notePlaceholder")} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="reason">{t("finance.approvals.reasonLabel")}</Label>
            <Textarea id="reason" placeholder={t("finance.approvals.reasonPlaceholder")} value={text} onChange={(e) => setText(e.target.value)}
              className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            />
          </div>
        )}

        <DialogFooter>
          <DialogClose
            render={
              <Button
                variant="outline"
                className="min-h-11 flex-1 sm:flex-none"
              />
            }
          >
            {t("finance.approvals.cancel")}
          </DialogClose>
          <Button
            className="min-h-11 flex-1 sm:flex-none"
            disabled={action === "reject" && (!isValid || submitting)}
            onClick={() => void handleSubmit()}
          >
            {submitting
              ? t("finance.approvals.submitting")
              : action === "approve"
                ? t("finance.approvals.approve")
                : t("finance.approvals.reject")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
