import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  CircleX,
  Clock,
  Download,
  FileText,
  Hourglass,
  Lock,
  Paperclip,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import type { FinancialEntryListItem, WorkOrderStatus } from "@routiq/contracts";
import type { CommandFormBack } from "@/components/command-form.js";
import { sessionStore } from "@/auth/store.js";
import { LoadingState } from "@/components/page";
import { StatusBadge } from "@/components/status-badge.js";
import { Button } from "@/components/ui/button";
import { SheetDescription, SheetFooter, SheetTitle } from "@/components/ui/sheet";
import { errorMessage } from "@/lib/error-message.js";
import { WORK_ORDER_TONES } from "@/maintenance/columns.js";
import { cn } from "@/lib/utils";
import { useVehicle } from "../context.js";
import type { RecordSteps } from "../flow.js";
import type { Step } from "../model.js";
import { useLockText, useStepLabel } from "../parts.js";
import { STEP_ICONS } from "../steps.js";

/** What every form opened on a record gets from the panel. */
export function useFormHost(recordLabel: string): {
  back: CommandFormBack;
  onDone: () => void;
  onDismiss: () => void;
} {
  const { panel, refresh } = useVehicle();
  return {
    back: { label: recordLabel, onBack: panel.closeForm },
    onDone: () => void refresh(),
    onDismiss: panel.closeForm,
  };
}

export function PanelLoading() {
  const { t } = useTranslation();
  return (
    <div className="p-4">
      <SheetTitle className="sr-only">{t("vehicle.panel.loading")}</SheetTitle>
      <LoadingState label={t("vehicle.panel.loading")} rows={3} />
    </div>
  );
}

/** Gone, out of scope, or a section this role does not read: one answer for all three. */
export function PanelMissing({ onRetry }: { onRetry?: (() => void) | undefined }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 p-4 pr-12">
      <SheetTitle>{t("vehicle.panel.notFound")}</SheetTitle>
      <SheetDescription>{t("vehicle.panel.notFoundHint")}</SheetDescription>
      {onRetry && (
        <Button variant="outline" className="h-9" onClick={onRetry}>
          {t("vehicle.panel.retry")}
        </Button>
      )}
    </div>
  );
}

/**
 * The footer holds this record's steps for this role only. The role's own next
 * step is solid; a step it waits for is shown locked with the reason; with
 * nothing to do, a line says who the record is waiting on.
 */
export function PanelFooter({
  steps,
  waiting,
  onStep,
}: {
  steps: RecordSteps;
  waiting?: string | null | undefined;
  onStep: (step: Step) => void;
}) {
  const stepLabel = useStepLabel();
  const lockText = useLockText();
  const open = steps.offered.filter((offered) => offered.lock === undefined).map((o) => o.step);
  const solidKey = steps.primary.kind === "go" ? steps.primary.step.key : null;
  const ordered = [...open].sort((a, b) => Number(b.key === solidKey) - Number(a.key === solidKey));
  const lock =
    steps.primary.kind === "locked"
      ? { step: steps.primary.step, lock: steps.primary.lock }
      : (() => {
          const first = steps.offered.find((offered) => offered.lock !== undefined);
          return first?.lock === undefined ? undefined : { step: first.step, lock: first.lock };
        })();
  const note = lock === undefined && open.length === 0 && waiting ? waiting : null;
  if (ordered.length === 0 && lock === undefined && note === null) return null;

  return (
    <SheetFooter className="sticky bottom-0 z-20 gap-3 border-t bg-popover">
      {note !== null && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Hourglass className="mt-0.5 size-4 shrink-0" aria-hidden />
          {note}
        </p>
      )}
      {lock !== undefined && (
        <div className="flex items-center gap-3">
          <Button variant="outline" disabled className="h-9 shrink-0">
            <Lock aria-hidden />
            {stepLabel(lock.step)}
          </Button>
          <p className="text-xs leading-snug text-muted-foreground">{lockText(lock.lock)}</p>
        </div>
      )}
      {ordered.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {ordered.map((step, index) => {
            const Icon = STEP_ICONS[step.key];
            return (
              <Button
                key={step.key}
                variant={step.key === solidKey ? "default" : "outline"}
                className={cn(
                  "h-10 sm:h-9",
                  index === 0 && ordered.length > 2 ? "basis-full sm:basis-auto" : "flex-1 sm:flex-none",
                )}
                onClick={() => onStep(step)}
              >
                <Icon aria-hidden />
                {stepLabel(step)}
              </Button>
            );
          })}
        </div>
      )}
    </SheetFooter>
  );
}

const WO_ICON: Record<WorkOrderStatus, typeof Clock> = {
  SUBMITTED: Clock,
  APPROVED: Hourglass,
  COMPLETION_SUBMITTED: Clock,
  COMPLETED: Check,
  REJECTED: CircleX,
  CANCELLED: CircleX,
};

export function WorkOrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  const { t } = useTranslation();
  return (
    <StatusBadge tone={WORK_ORDER_TONES[status]} icon={WO_ICON[status]} className="rounded-md">
      {t(`maintenance.workOrders.status.${status}`)}
    </StatusBadge>
  );
}

type EntryStatus = FinancialEntryListItem["status"];

const ENTRY_TONE = { POSTED: "neutral", SUBMITTED: "warning", REJECTED: "danger", REVERSED: "neutral" } as const;
const ENTRY_ICON = { POSTED: Check, SUBMITTED: Clock, REJECTED: CircleX, REVERSED: Undo2 } as const;

export function EntryStatusBadge({ status }: { status: EntryStatus }) {
  const { t } = useTranslation();
  return (
    <StatusBadge tone={ENTRY_TONE[status]} icon={ENTRY_ICON[status]} className="rounded-md">
      {t(`finance.entries.status.${status}`)}
    </StatusBadge>
  );
}

/** Four honest states, none of them "verified"; a reversal row carries none. */
export function EvidenceMark({
  entry,
  quiet = false,
}: {
  entry: Pick<FinancialEntryListItem, "evidence" | "reversesEntryId">;
  /** Rows show only the state that needs someone; the record shows all four. */
  quiet?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  if (entry.reversesEntryId !== null) return null;
  const state = entry.evidence.state;
  if (state === "NOT_SUPPLIED") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-warning-foreground">
        <TriangleAlert className="size-3.5" aria-hidden />
        {t("vehicle.evidence.NOT_SUPPLIED")}
      </span>
    );
  }
  if (quiet) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Paperclip className="size-3.5" aria-hidden />
      {t(`vehicle.evidence.${state}`)}
    </span>
  );
}

/**
 * One file behind a record. It opens through the record-scoped route the host
 * names (entry evidence, a document's scan, an issue's photo): that route
 * checks the record is readable, the generic artifact route never serves it.
 */
export function RecordFileRow({
  name,
  meta,
  downloadPath,
}: {
  name: string;
  meta?: string | undefined;
  downloadPath: string;
}) {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState<string>();

  async function open() {
    setError(undefined);
    const token = sessionStore.getToken();
    const response = await fetch(downloadPath, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(body?.error?.code ?? "READ_FAILED");
      return;
    }
    const { url } = (await response.json()) as { url: string };
    window.open(url, "_blank", "noopener");
  }

  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2.5">
      <div className="flex min-w-0 gap-2">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{name}</p>
          {meta !== undefined && <p className="text-xs text-muted-foreground">{meta}</p>}
          {error !== undefined && <p className="text-xs text-destructive">{errorMessage(i18n, error)}</p>}
        </div>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label={t("vehicle.panel.openFile")} onClick={() => void open()}>
        <Download aria-hidden />
      </Button>
    </li>
  );
}
