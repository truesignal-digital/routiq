import { useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ClipboardCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import { z } from "zod";
import { useMeContext } from "@/auth/me.js";
import { commandClient } from "@/commands/instance.js";
import { createCommandIntent, type CommandIntent } from "@/commands/intent.js";
import { DataTable, DataTableViewOptions } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner.js";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
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
import { FinanceToolbar } from "@/finance/FinanceToolbar.js";
import { FinanceStatusBadge } from "@/finance/FinanceStatusBadge.js";
import { isOwnSubmission, validateRejectionReason } from "@/finance/model.js";
import { canApproveEntries } from "@/finance/permissions.js";
import { useApprovals } from "@/finance/useApprovals.js";
import { formatDate, formatMoney, localizedLabel } from "@/lib/format.js";
import {
  notifyCommandSuccess,
  notifyCommandWarnings,
} from "@/lib/notify.js";
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

export function FinanceApprovalsScreen() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const me = useMeContext();
  const canApprove = canApproveEntries(me?.role, me?.enabledModules);

  const approvalsQuery = useApprovals(canApprove);
  const [actionDialog, setActionDialog] = useState<ActionDialogState>({ open: false });
  const [removedEntryIds, setRemovedEntryIds] = useState<Set<string>>(new Set());
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const approveIntentRef = useRef<CommandIntent<ApproveEntryPayloadType> | undefined>(undefined);
  const rejectIntentRef = useRef<CommandIntent<RejectEntryPayloadType> | undefined>(undefined);
  const [actionError, setActionError] = useState<string>();

  const entries = (approvalsQuery.data?.entries ?? []).filter(
    (e) => !removedEntryIds.has(e.id),
  );
  // The queue carries no toolbar: `/v1/finance/approvals` takes no filter or
  // sort params, and it answers with at most 100 rows next to a separate
  // `total`. Both a filter and a sort control would therefore act on a prefix
  // of the queue while looking like they act on all of it.
  const columns = useMemo<ColumnDef<PendingApprovalItem>[]>(
    () => [
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
        header: t("finance.entries.detail.amount"),
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
        id: "actions",
        header: t("finance.approvals.columns.actions"),
        // Hiding the decision buttons would leave an approver a queue they
        // cannot act on.
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
          ) : (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setActionDialog({
                    open: true,
                    entryId: row.original.id,
                    action: "approve",
                    rowVersion: row.original.rowVersion,
                  })
                }
              >
                {t("finance.approvals.approve")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() =>
                  setActionDialog({
                    open: true,
                    entryId: row.original.id,
                    action: "reject",
                    rowVersion: row.original.rowVersion,
                  })
                }
              >
                {t("finance.approvals.reject")}
              </Button>
            </div>
          ),
      },
    ],
    [i18n.resolvedLanguage, me?.principalId, t],
  );

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
        setRemovedEntryIds(new Set());
        return;
      }
      setActionError(result.code);
      return;
    }

    setRemovedEntryIds((prev) => new Set([...prev, entryId]));
    notifyCommandSuccess("approved");
    notifyCommandWarnings(result.outcome.warnings);
    setActionDialog({ open: false });
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
        setRemovedEntryIds(new Set());
        return;
      }
      setActionError(result.code);
      return;
    }

    setRemovedEntryIds((prev) => new Set([...prev, entryId]));
    notifyCommandSuccess("rejected");
    notifyCommandWarnings(result.outcome.warnings);
    setActionDialog({ open: false });
  };

  return (
    <PageContainer width="wide">
      {me !== undefined && !canApprove ? (
        <>
          <PageHeader title={t("finance.approvals.title")} />
          <EmptyState
            className="mt-6"
            icon={<ClipboardCheck className="size-7" aria-hidden />}
            message={t("finance.approvals.accessDenied")}
          />
        </>
      ) : (
        <>
          <PageHeader
            title={t("finance.approvals.title")}
            onBack={() => void navigate({ to: "/assets" })}
            backLabel={t("finance.approvals.back")}
          />
          <FinanceToolbar>
            {!approvalsQuery.isPending && !approvalsQuery.isError && (
              <DataTableViewOptions
                columns={columns}
                value={columnVisibility}
                onChange={setColumnVisibility}
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
        </>
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
            <textarea
              id="note"
              placeholder={t("finance.approvals.notePlaceholder")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="reason">{t("finance.approvals.reasonLabel")}</Label>
            <textarea
              id="reason"
              placeholder={t("finance.approvals.reasonPlaceholder")}
              value={text}
              onChange={(e) => setText(e.target.value)}
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
