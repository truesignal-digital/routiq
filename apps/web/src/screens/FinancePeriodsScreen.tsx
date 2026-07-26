import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, CalendarRange, Lock, Unlock } from "lucide-react";
import { formatMoney, formatDate, formatDateTime, localizedLabel } from "../lib/format.js";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useMeContext } from "../auth/me.js";
import { commandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import {
  notifyCommandSuccess,
  notifyCommandWarnings,
} from "../lib/notify.js";
import { usePeriods } from "../finance/usePeriods.js";
import {
  mergeImplicitCurrentPeriod,
  validateReopenReason,
} from "../finance/model.js";
import { canManagePeriods } from "../finance/permissions.js";
import {
  lockPeriodPayload,
  reopenPeriodPayload,
  type PeriodRead,
} from "@routiq/contracts";
import { FinanceNav } from "../finance/FinanceNav.js";
import { ErrorBanner } from "@/components/error-banner.js";

type LockPeriodPayloadType = z.infer<typeof lockPeriodPayload>;
type ReopenPeriodPayloadType = z.infer<typeof reopenPeriodPayload>;

type ActionDialogState =
  | { open: false }
  | { open: true; periodCode: string; action: "lock" | "reopen" };

export function FinancePeriodsScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMeContext();
  const canManage = canManagePeriods(me?.role, me?.enabledModules);

  const periodsQuery = usePeriods();
  const [actionDialog, setActionDialog] = useState<ActionDialogState>({ open: false });
  const [removedPeriods, setRemovedPeriods] = useState<Set<string>>(new Set());
  const lockIntentRef = useRef<CommandIntent<LockPeriodPayloadType> | undefined>(undefined);
  const reopenIntentRef = useRef<CommandIntent<ReopenPeriodPayloadType> | undefined>(undefined);
  const [actionError, setActionError] = useState<string>();

  const periods = mergeImplicitCurrentPeriod(
    (periodsQuery.data?.periods ?? []).filter((p) => !removedPeriods.has(p.periodCode)),
  ).sort((a, b) => b.periodCode.localeCompare(a.periodCode));

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

    setRemovedPeriods((prev) => new Set([...prev, periodCode]));
    notifyCommandSuccess("locked");
    notifyCommandWarnings(result.outcome.warnings);
    setActionDialog({ open: false });
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

    setRemovedPeriods((prev) => new Set([...prev, periodCode]));
    notifyCommandSuccess("reopened");
    notifyCommandWarnings(result.outcome.warnings);
    setActionDialog({ open: false });
  };

  if (me !== undefined && !canManage) {
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-6">
        <PageHeader title={t("finance.periods.title")} />
        <EmptyState
          className="mt-6"
          icon={<CalendarRange className="size-7" aria-hidden />}
          message={t("finance.periods.accessDenied")}
        />
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6">
      <PageHeader
        title={t("finance.periods.title")}
        onBack={() => void navigate({ to: "/assets" })}
        backLabel={t("finance.periods.back")}
      />
      <FinanceNav />

      {periodsQuery.isPending ? (
        <LoadingState className="mt-6" label={t("finance.periods.loading")} />
      ) : periodsQuery.isError ? (
        <ErrorState
          className="mt-6"
          message={t("finance.periods.loadFailed")}
          retryLabel={t("finance.periods.retry")}
          onRetry={() => void periodsQuery.refetch()}
        />
      ) : periods.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={<CalendarRange className="size-7" aria-hidden />}
          message={t("finance.periods.empty")}
        />
      ) : (
        <div className="mt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("finance.periods.columns.period")}</TableHead>
                <TableHead>{t("finance.periods.columns.status")}</TableHead>
                <TableHead>{t("finance.periods.columns.entries")}</TableHead>
                <TableHead className="text-right">
                  {t("finance.periods.columns.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {periods.map((period) => (
                <PeriodRow
                  key={period.periodCode}
                  period={period}
                  onLock={() =>
                    setActionDialog({
                      open: true,
                      periodCode: period.periodCode,
                      action: "lock",
                    })
                  }
                  onReopen={() =>
                    setActionDialog({
                      open: true,
                      periodCode: period.periodCode,
                      action: "reopen",
                    })
                  }
                />
              ))}
            </TableBody>
          </Table>
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

    </section>
  );
}

function PeriodRow({
  period,
  onLock,
  onReopen,
}: {
  period: PeriodRead;
  onLock: () => void;
  onReopen: () => void;
}) {
  const { t } = useTranslation();

  const isOpen = period.status === "OPEN";
  const lockedDate = period.lockedAt
    ? formatDate(period.lockedAt)
    : null;

  return (
    <TableRow>
      <TableCell className="font-medium">{period.periodCode}</TableCell>
      <TableCell>
        {isOpen
          ? t("finance.periods.statusOpen")
          : t("finance.periods.statusLocked", { date: lockedDate })}
      </TableCell>
      <TableCell>{t("finance.periods.entryCount", { count: period.entryCount })}</TableCell>
      <TableCell className="text-right">
        {isOpen ? (
          <Button size="sm" variant="outline" onClick={onLock}>
            <Lock className="mr-2 size-4" aria-hidden />
            {t("finance.periods.lock")}
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onReopen}>
            <Unlock className="mr-2 size-4" aria-hidden />
            {t("finance.periods.reopen")}
          </Button>
        )}
      </TableCell>
    </TableRow>
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
          <textarea
            id="reason"
            placeholder={t("finance.periods.reasonPlaceholder")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          />
        </div>

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
