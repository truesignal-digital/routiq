import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Lock, Unlock } from "lucide-react";
import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import { formatDate } from "@/lib/format.js";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { DataTable, DataTableViewOptions } from "@/components/data-table";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { useMeContext } from "@/auth/me.js";
import { useActiveSession } from "@/auth/store.js";
import { commandClient } from "@/commands/instance.js";
import { createCommandIntent, type CommandIntent } from "@/commands/intent.js";
import { notifyCommandSuccess } from "@/lib/notify.js";
import { usePeriods } from "@/finance/usePeriods.js";
import {
  mergeImplicitCurrentPeriod,
  validateReopenReason,
} from "@/finance/model.js";
import { canManagePeriods } from "@/finance/permissions.js";
import {
  lockPeriodPayload,
  reopenPeriodPayload,
  type PeriodRead,
} from "@routiq/contracts";
import { FinanceToolbar } from "@/finance/FinanceToolbar.js";
import { ErrorBanner } from "@/components/error-banner.js";

type LockPeriodPayloadType = z.infer<typeof lockPeriodPayload>;
type ReopenPeriodPayloadType = z.infer<typeof reopenPeriodPayload>;

type ActionDialogState =
  | { open: false }
  | { open: true; periodCode: string; action: "lock" | "reopen" };

export function FinancePeriodsScreen() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const session = useActiveSession();
  const me = useMeContext();
  const canManage = canManagePeriods(me?.role, me?.enabledModules);

  const periodsQuery = usePeriods();
  const [actionDialog, setActionDialog] = useState<ActionDialogState>({ open: false });
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const lockIntentRef = useRef<CommandIntent<LockPeriodPayloadType> | undefined>(undefined);
  const reopenIntentRef = useRef<CommandIntent<ReopenPeriodPayloadType> | undefined>(undefined);
  const [actionError, setActionError] = useState<string>();

  const periods = mergeImplicitCurrentPeriod(periodsQuery.data?.periods ?? []);

  // ADR-0001: the period list re-renders from the server's answer, never from a
  // locally patched cache.
  const invalidatePeriods = () =>
    queryClient.invalidateQueries({
      queryKey: ["ws", session?.workspaceSlug, "finance", "periods"],
    });

  // Every column sorts. `/v1/finance/periods` is unpaginated — the whole list
  // is in memory — so ordering it client-side reorders all of the data, not a
  // loaded prefix. Newest period first is the default view.
  const columns = useMemo<ColumnDef<PeriodRead>[]>(
    () => [
      {
        accessorKey: "periodCode",
        header: t("finance.periods.columns.period"),
        enableSorting: true,
        meta: { mobile: "primary", label: t("finance.periods.columns.period") },
        cell: ({ row }) => (
          <span className="font-medium">{row.original.periodCode}</span>
        ),
      },
      {
        accessorKey: "status",
        header: t("finance.periods.columns.status"),
        enableSorting: true,
        meta: { mobile: "secondary", label: t("finance.periods.columns.status") },
        cell: ({ row }) =>
          row.original.status === "OPEN"
            ? t("finance.periods.statusOpen")
            : t("finance.periods.statusLocked", {
                date: formatDate(row.original.lockedAt),
              }),
      },
      {
        accessorKey: "entryCount",
        header: t("finance.periods.columns.entries"),
        enableSorting: true,
        meta: { mobile: "secondary", label: t("finance.periods.columns.entries") },
        cell: ({ row }) =>
          t("finance.periods.entryCount", { count: row.original.entryCount }),
      },
    ],
    [i18n.resolvedLanguage, t],
  );

  const rowActions = (period: PeriodRead) => {
    // role-config: locking and reopening are the period manager's calls; a role
    // without them sees a read-only ledger.
    if (!canManage) return [];

    return period.status === "OPEN"
      ? [
          {
            key: "lock",
            label: t("finance.periods.lock"),
            icon: Lock,
            onSelect: () =>
              setActionDialog({
                open: true,
                periodCode: period.periodCode,
                action: "lock" as const,
              }),
          },
        ]
      : [
          {
            key: "reopen",
            label: t("finance.periods.reopen"),
            icon: Unlock,
            onSelect: () =>
              setActionDialog({
                open: true,
                periodCode: period.periodCode,
                action: "reopen" as const,
              }),
          },
        ];
  };

  const handleLock = async (periodCode: string) => {
    setActionError(undefined);
    lockIntentRef.current ??= createCommandIntent<LockPeriodPayloadType>(
      commandClient,
      "lock-period",
      1,
    );

    const result = await lockIntentRef.current.submit({ periodCode });

    if (!result.ok) {
      setActionError(result.code);
      return;
    }

    notifyCommandSuccess("finance", "locked", result.outcome.warnings);
    setActionDialog({ open: false });
    await invalidatePeriods();
  };

  const handleReopen = async (periodCode: string, reason: string) => {
    setActionError(undefined);
    reopenIntentRef.current ??= createCommandIntent<ReopenPeriodPayloadType>(
      commandClient,
      "reopen-period",
      1,
    );

    const result = await reopenIntentRef.current.submit({ periodCode, reason });

    if (!result.ok) {
      setActionError(result.code);
      return;
    }

    notifyCommandSuccess("finance", "reopened", result.outcome.warnings);
    setActionDialog({ open: false });
    await invalidatePeriods();
  };

  if (me !== undefined && !canManage) {
    return (
      <PermissionDenied
        title={t("finance.periods.title")}
        icon={<CalendarRange className="size-7" aria-hidden />}
        code={deniedCode(me.enabledModules.includes("FINANCE"))}
      />
    );
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title={t("finance.periods.title")}
      />
      <FinanceToolbar>
        {!periodsQuery.isPending && !periodsQuery.isError && (
          <DataTableViewOptions
            columns={columns}
            value={columnVisibility}
            onChange={setColumnVisibility}
            primaryColumn={{ columnId: "periodCode" }}
          />
        )}
      </FinanceToolbar>

      {periodsQuery.isPending ? (
        <LoadingState className="mt-6" label={t("finance.periods.loading")} />
      ) : periodsQuery.isError ? (
        <ErrorState
          className="mt-6"
          message={t("finance.periods.loadFailed")}
          retryLabel={t("finance.periods.retry")}
          onRetry={() => void periodsQuery.refetch()}
        />
      ) : (
        <div className="mt-6">
          <DataTable
            columns={columns}
            data={periods}
            getRowId={(period) => period.periodCode}
            defaultSorting={[{ id: "periodCode", desc: true }]}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            // A period has no detail view, so its primary cell is emphasis
            // only — no activation is configured, so the table renders it as
            // plain text rather than a trigger.
            primaryColumn={{ columnId: "periodCode" }}
            rowActions={rowActions}
            // The periods read is unpaginated, so the page count is real.
            pagination={{ defaultPageSize: 10 }}
            emptyState={
              <EmptyState
                icon={<CalendarRange className="size-7" aria-hidden />}
                message={t("finance.periods.empty")}
              />
            }
          />
        </div>
      )}

      {actionDialog.open && (
        <ActionDialog
          action={actionDialog.action}
          onLock={() => handleLock(actionDialog.periodCode)}
          onReopen={(reason) => handleReopen(actionDialog.periodCode, reason)}
          onCancel={() => setActionDialog({ open: false })}
          error={actionError}
        />
      )}

    </PageContainer>
  );
}

function ActionDialog({
  action,
  onLock,
  onReopen,
  onCancel,
  error,
}: {
  action: "lock" | "reopen";
  onLock: () => Promise<void>;
  onReopen: (reason: string) => Promise<void>;
  onCancel: () => void;
  error: string | undefined;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (action === "lock") {
        await onLock();
      } else {
        await onReopen(reason);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (action === "lock") {
    return (
      <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
        <AlertDialogContent onBackdropClick={onCancel}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("finance.periods.lockTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("finance.periods.lockExplanation")}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {error && (
            <ErrorBanner code={error} />
          )}

          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11 flex-1 sm:flex-none">
              {t("finance.periods.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="min-h-11 flex-1 sm:flex-none"
              disabled={submitting}
              onClick={() => void handleSubmit()}
            >
              {submitting
                ? t("finance.periods.submitting")
                : t("finance.periods.lock")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("finance.periods.reopenTitle")}</DialogTitle>
        </DialogHeader>

        {error && (
          <ErrorBanner code={error} />
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="reason">{t("finance.periods.reasonLabel")}</Label>
          <Textarea
            id="reason"
            placeholder={t("finance.periods.reasonPlaceholder")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />        </div>

        <DialogFooter>
          <DialogClose
            render={
              <Button
                variant="outline"
                className="min-h-11 flex-1 sm:flex-none"
              />
            }
          >
            {t("finance.periods.cancel")}
          </DialogClose>
          <Button
            className="min-h-11 flex-1 sm:flex-none"
            disabled={!validateReopenReason(reason) || submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting
              ? t("finance.periods.submitting")
              : t("finance.periods.reopen")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
