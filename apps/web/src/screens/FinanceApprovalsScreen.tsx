import { useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import { DataTable } from "@/components/data-table";
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
import { useMeContext } from "../auth/me.js";
import { commandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import {
  notifyCommandSuccess,
  notifyCommandWarnings,
} from "../lib/notify.js";
import { useApprovals } from "../finance/useApprovals.js";
import { canApproveEntries } from "../finance/permissions.js";
import { isOwnSubmission, validateRejectionReason } from "../finance/model.js";
import { FinanceNav } from "../finance/FinanceNav.js";
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
  const approveIntentRef = useRef<CommandIntent<ApproveEntryPayloadType> | undefined>(undefined);
  const rejectIntentRef = useRef<CommandIntent<RejectEntryPayloadType> | undefined>(undefined);
  const [actionError, setActionError] = useState<string>();

  const entries = (approvalsQuery.data?.entries ?? []).filter(
    (e) => !removedEntryIds.has(e.id),
  );
  const columns = useMemo<ColumnDef<PendingApprovalItem>[]>(
    () => [
      {
        accessorKey: "status",
        header: t("finance.entries.detail.status"),
        meta: { mobile: "primary" },
        cell: ({ row }) => t(`finance.entries.status.${row.original.status}`),
      },
      {
        accessorKey: "submittedAt",
        header: t("finance.entries.detail.date"),
        meta: { mobile: "secondary" },
        cell: ({ row }) => new Date(row.original.submittedAt).toLocaleDateString(),
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
          <span className="whitespace-nowrap font-mono font-semibold">
            {formatAmount(row.original.amountMinor)} {row.original.currency}
          </span>
        ),
      },
      {
        accessorKey: "counterpartyName",
        header: t("finance.entries.detail.counterparty"),
        meta: { mobile: "secondary" },
        cell: ({ row }) => row.original.counterpartyName ?? "—",
      },
      {
        id: "actions",
        header: "",
        meta: { mobile: "primary" },
        cell: ({ row }) =>
          isOwnSubmission(row.original.submittedByPrincipalId, me?.principalId) ? (
            <p className="text-xs font-medium text-amber-900">
              {t("finance.approvals.makerGuard")}
            </p>
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

  if (!canApprove) {
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-semibold">{t("finance.approvals.title")}</h1>
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {t("finance.approvals.accessDenied")}
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
        {t("finance.approvals.back")}
      </button>
      <h1 className="mt-2 text-2xl font-semibold">{t("finance.approvals.title")}</h1>
      <FinanceNav />

      {approvalsQuery.isPending ? (
        <p className="mt-6 text-sm text-muted-foreground">{t("finance.approvals.loading")}</p>
      ) : approvalsQuery.isError ? (
        <div role="alert" className="mt-6 flex flex-col gap-3">
          <p className="text-sm text-destructive">{t("finance.approvals.loadFailed")}</p>
          <Button
            variant="outline"
            className="min-h-11 self-start"
            onClick={() => void approvalsQuery.refetch()}
          >
            {t("finance.approvals.retry")}
          </Button>
        </div>
      ) : (
        <div className="mt-6">
          <DataTable
            columns={columns}
            data={entries}
            emptyState={
              <p className="text-sm text-muted-foreground">
                {t("finance.approvals.empty")}
              </p>
            }
          />
        </div>
      )}

      {actionDialog.open && (
        <ActionDialog
          action={actionDialog.action}
          onApprove={(note) => handleApprove(actionDialog.entryId, actionDialog.rowVersion, note)}
          onReject={(reason) =>
            handleReject(actionDialog.entryId, actionDialog.rowVersion, reason)
          }
          onCancel={() => setActionDialog({ open: false })}
          error={actionError}
        />
      )}

    </section>
  );
}

function formatAmount(minor: number) {
  return new Intl.NumberFormat("fr-CM", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(minor);
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

        {error && (
          <div
            role="alert"
            className="flex gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 flex-shrink-0" aria-hidden />
            <p>{t(`errors.${error}`, { defaultValue: error })}</p>
          </div>
        )}

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
