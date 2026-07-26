import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, CheckCircle2, Lock, Unlock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { errorMessage } from "../lib/error-message.js";
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

type SuccessDialogState =
  | { open: false }
  | { open: true; message: string; warnings?: string[] };

export function FinancePeriodsScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMeContext();
  const queryClient = useQueryClient();
  const canManage = canManagePeriods(me?.role, me?.enabledModules);

  const periodsQuery = usePeriods();
  const [actionDialog, setActionDialog] = useState<ActionDialogState>({ open: false });
  const [successDialog, setSuccessDialog] = useState<SuccessDialogState>({ open: false });
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
    setSuccessDialog({
      open: true,
      message: t("finance.periods.locked"),
      warnings: result.outcome.warnings,
    });
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
    setSuccessDialog({
      open: true,
      message: t("finance.periods.reopened"),
    });
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

      {successDialog.open && (
        <SuccessDialog
          message={successDialog.message}
          warnings={successDialog.warnings}
          onClose={() => setSuccessDialog({ open: false })}
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

  const isValid = action === "lock" ? true : validateReopenReason(reason);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-xl bg-white p-6">
        <h2 className="text-lg font-semibold">
          {action === "lock" ? t("finance.periods.lockTitle") : t("finance.periods.reopenTitle")}
        </h2>

        {error && (
          <div role="alert" className="mt-4 flex gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 flex-shrink-0" aria-hidden />
            <p>{t(`errors.${error}`, { defaultValue: error })}</p>
          </div>
        )}

        {action === "lock" && (
          <p className="mt-4 text-sm text-muted-foreground">
            {t("finance.periods.lockExplanation")}
          </p>
        )}

        {action === "reopen" && (
          <div className="mt-4 flex flex-col gap-2">
            <Label htmlFor="reason">{t("finance.periods.reasonLabel")}</Label>
            <textarea
              id="reason"
              placeholder={t("finance.periods.reasonPlaceholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            />
          </div>
        )}

        <div className="mt-6 flex gap-2">
          <Button
            variant="outline"
            className="min-h-11 flex-1"
            onClick={onCancel}
            disabled={submitting}
          >
            {t("finance.periods.cancel")}
          </Button>
          <Button
            className="min-h-11 flex-1"
            disabled={!isValid || submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting
              ? t("finance.periods.submitting")
              : action === "lock"
                ? t("finance.periods.lock")
                : t("finance.periods.reopen")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SuccessDialog({
  message,
  warnings,
  onClose,
}: {
  message: string;
  warnings: string[] | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-xl bg-white p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-6 text-green-600" aria-hidden />
          <div>
            <h2 className="font-semibold text-green-900">{message}</h2>
            {warnings && warnings.length > 0 && (
              <div className="mt-3 border-t border-green-200 pt-3">
                <p className="text-xs font-semibold uppercase text-green-900">
                  {t("finance.periods.warningsLabel")}
                </p>
                <ul className="mt-2 space-y-1">
                  {warnings.map((warning, idx) => (
                    <li key={idx} className="text-xs text-green-800">
                      {warning === "PERIOD_HAS_SUBMITTED_ENTRIES"
                        ? t("finance.periods.warningSubmittedEntries")
                        : warning}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
        <Button onClick={onClose} className="min-h-11 mt-4 w-full">
          {t("finance.periods.done")}
        </Button>
      </div>
    </div>
  );
}
