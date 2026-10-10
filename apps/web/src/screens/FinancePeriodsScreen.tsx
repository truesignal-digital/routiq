import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Lock, Unlock } from "lucide-react";
import type { VisibilityState } from "@tanstack/react-table";
import { formatDate } from "@/lib/format.js";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import { z } from "zod";
import {
  DataTable,
  DataTableViewOptions,
  type DataTableColumn,
} from "@/components/data-table";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { PermissionDenied } from "@/components/permission-denied.js";
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
import { canManagePeriods, canReopenPeriod } from "@/finance/permissions.js";
import {
  lockPeriodPayload,
  reopenPeriodPayload,
  type PeriodRead,
} from "@routiq/contracts";
import { ErrorBanner } from "@/components/error-banner.js";

type LockPeriodPayloadType = z.infer<typeof lockPeriodPayload>;
type ReopenPeriodPayloadType = z.infer<typeof reopenPeriodPayload>;

type ActionDialogState =
  | { open: false }
  | { open: true; periodCode: string; action: "lock" | "reopen" };

export function FinancePeriodsScreen() {
  const { t, i18n } = useTranslation();
  const label = useCommandLabel();
  const queryClient = useQueryClient();
  const session = useActiveSession();
  const me = useMeContext();
  const canManage = canManagePeriods(me?.role, me?.enabledModules);
  const canReopen = canReopenPeriod(me?.role, me?.enabledModules);

  const periodsQuery = usePeriods();
  const [actionDialog, setActionDialog] = useState<ActionDialogState>({ open: false });
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const lockIntentRef = useRef<CommandIntent<LockPeriodPayloadType> | undefined>(undefined);
  const reopenIntentRef = useRef<CommandIntent<ReopenPeriodPayloadType> | undefined>(undefined);
  const [actionError, setActionError] = useState<string>();

  const currentPeriod = periodsQuery.data?.currentPeriodCode;
  const periods =
    periodsQuery.data === undefined
      ? []
      : mergeImplicitCurrentPeriod(periodsQuery.data.periods, periodsQuery.data.currentPeriodCode);

  // ADR-0001: the period list re-renders from the server's answer, never from a
  // locally patched cache.
  const invalidatePeriods = () =>
    queryClient.invalidateQueries({
      queryKey: ["ws", session?.workspaceSlug, "finance", "periods"],
    });

  // Both period commands version-check the stored row (§5.3), so they carry
  // the version this screen shows. The current month may have no row yet; its
  // implicit version 0 is ignored by lock-period until a row exists (#571).
  const shownVersion = (periodCode: string) =>
    periods.find((period) => period.periodCode === periodCode)?.rowVersion ?? 0;

  // A conflict means the shown version is stale: reload the months so a
  // second try sends the fresh one.
  const failAction = async (code: string) => {
    setActionError(code);
    if (code === "VERSION_CONFLICT") await invalidatePeriods();
  };

  // Every column sorts. `/v1/finance/periods` is unpaginated — the whole list
  // is in memory — so ordering it client-side reorders all of the data, not a
  // loaded prefix. Newest period first is the default view.
  const columns = useMemo<DataTableColumn<PeriodRead>[]>(
    () => [
      {
        accessorKey: "periodCode",
        header: t("finance.periods.columns.period"),
        enableSorting: true,
        meta: { phone: "title", label: t("finance.periods.columns.period") },
        cell: ({ row }) => (
          <span className="font-medium">{row.original.periodCode}</span>
        ),
      },
      {
        accessorKey: "status",
        header: t("finance.periods.columns.status"),
        enableSorting: true,
        meta: { phone: "status", label: t("finance.periods.columns.status") },
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
        meta: { phone: "value", label: t("finance.periods.columns.entries") },
        cell: ({ row }) =>
          t("finance.periods.entryCount", { count: row.original.entryCount }),
      },
    ],
    [i18n.resolvedLanguage, t],
  );

  const rowActions = (period: PeriodRead) => {
    // role-config: locking is the period manager's call, reopening the
    // Director's alone; a role without them sees a read-only ledger.
    if (!canManage) return [];
    if (period.status !== "OPEN" && !canReopen) return [];

    return period.status === "OPEN"
      ? [
          {
            key: "lock",
            label: label("lock-period"),
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
            label: label("reopen-period"),
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

    const result = await lockIntentRef.current.submit(
      { periodCode },
      { expectedVersion: shownVersion(periodCode) },
    );

    if (!result.ok) {
      await failAction(result.code);
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

    const result = await reopenIntentRef.current.submit(
      { periodCode, reason },
      { expectedVersion: shownVersion(periodCode) },
    );

    if (!result.ok) {
      await failAction(result.code);
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
        code="ROLE_FORBIDDEN"
      />
    );
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title={t("finance.periods.title")}
      />
      <p className="mt-1 text-sm text-muted-foreground">{t("finance.periods.lead")}</p>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        {!periodsQuery.isPending && !periodsQuery.isError && (
          <DataTableViewOptions
            columns={columns}
            value={columnVisibility}
            onChange={setColumnVisibility}
            primaryColumn={{ columnId: "periodCode" }}
          />
        )}
      </div>

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
          current={actionDialog.periodCode === currentPeriod}
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
  current,
  onLock,
  onReopen,
  onCancel,
  error,
}: {
  action: "lock" | "reopen";
  /** Locking the current month stops posting; any other month sends late entries to the current one. */
  current: boolean;
  onLock: () => Promise<void>;
  onReopen: (reason: string) => Promise<void>;
  onCancel: () => void;
  error: string | undefined;
}) {
  const { t } = useTranslation();
  const label = useCommandLabel();
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
            <AlertDialogTitle>{label("lock-period")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(current ? "finance.periods.lockCurrentExplanation" : "finance.periods.lockExplanation")}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {error && (
            <ErrorBanner code={error} />
          )}

          <AlertDialogFooter>
            <AlertDialogCancel className="flex-1 sm:flex-none">
              {t("finance.periods.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="flex-1 sm:flex-none"
              disabled={submitting}
              onClick={() => void handleSubmit()}
            >
              {submitting
                ? label("lock-period", "submitting")
                : label("lock-period")}
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
          <DialogTitle>{label("reopen-period")}</DialogTitle>
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
                className="flex-1 sm:flex-none"
              />
            }
          >
            {t("finance.periods.cancel")}
          </DialogClose>
          <Button
            className="flex-1 sm:flex-none"
            disabled={!validateReopenReason(reason) || submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting
              ? label("reopen-period", "submitting")
              : label("reopen-period")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
