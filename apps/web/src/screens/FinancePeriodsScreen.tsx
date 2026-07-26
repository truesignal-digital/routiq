import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, Lock, Unlock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
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

  if (!canManage) {
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-semibold">{t("finance.periods.title")}</h1>
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {t("finance.periods.accessDenied")}
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6">
      <button
        type="button"
        className="flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground"
        onClick={() => void navigate({ to: "/assets" })}
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("finance.periods.back")}
      </button>
      <h1 className="mt-2 text-2xl font-semibold">{t("finance.periods.title")}</h1>
      <FinanceNav />

      {periodsQuery.isPending ? (
        <p className="mt-6 text-sm text-muted-foreground">{t("finance.periods.loading")}</p>
      ) : periodsQuery.isError ? (
        <div role="alert" className="mt-6 flex flex-col gap-3">
          <p className="text-sm text-destructive">{t("finance.periods.loadFailed")}</p>
          <Button
            variant="outline"
            className="min-h-11 self-start"
            onClick={() => void periodsQuery.refetch()}
          >
            {t("finance.periods.retry")}
          </Button>
        </div>
      ) : periods.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">{t("finance.periods.empty")}</p>
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
    ? new Date(period.lockedAt).toLocaleDateString()
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
            <div
              role="alert"
              className="flex gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 flex-shrink-0" aria-hidden />
              <p>{t(`errors.${error}`, { defaultValue: error })}</p>
            </div>
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
          <div
            role="alert"
            className="flex gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 flex-shrink-0" aria-hidden />
            <p>{t(`errors.${error}`, { defaultValue: error })}</p>
          </div>
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
