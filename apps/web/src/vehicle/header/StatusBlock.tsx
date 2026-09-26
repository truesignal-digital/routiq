import { useId, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Ban,
  CircleQuestionMark,
  FileExclamationPoint,
  Lock,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, formatRelativeTime, localizedLabel } from "@/lib/format.js";
import { cn } from "@/lib/utils";
import { useWorkOrder } from "@/maintenance/useMaintenance.js";
import { useVehicle } from "../context.js";
import { completionSignedOff, groundingFacts, groundingStep, situationOf, type Situation } from "../flow.js";
import { recordReference, type PanelRef, type RoleStep } from "../model.js";
import { LinkButton, useLockText, useStepLabel, withNodes } from "../parts.js";
import { STEP_ICONS } from "../steps.js";

type Tone = "critical" | "success" | "neutral";

const REPORT_MAX = 140;

function truncate(text: string): string {
  return text.length > REPORT_MAX ? `${text.slice(0, REPORT_MAX - 1).trimEnd()}…` : text;
}

function monthYear(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(iso));
}

/**
 * One sentence that says whether the vehicle may be used and what it waits
 * for, the one step this role takes next beside it, and any other hard stop
 * underneath. The report is quoted, never paraphrased into a grammar only
 * English has.
 */
export function StatusBlock({ now = new Date() }: { now?: Date }) {
  const { t, i18n } = useTranslation();
  const { asset, attention, viewer, panel } = useVehicle();
  const locale = i18n.language;
  // Only the work order's timeline says whether its completion was signed off.
  const completed = groundingFacts(asset)?.workOrder;
  const completedOrder = useWorkOrder(completed?.status === "COMPLETED" ? completed.id : undefined);
  const situation = situationOf(asset, attention, now, completionSignedOff(completedOrder.data?.chronologie));
  const openRef = (ref: PanelRef) => panel.openRecord(ref);

  const refLink = (kind: "work_order" | "issue", id: string | undefined) =>
    id === undefined ? null : (
      <LinkButton onClick={() => openRef({ kind, id })}>{recordReference(id)}</LinkButton>
    );

  let tone: Tone = "neutral";
  let Icon: LucideIcon = CircleQuestionMark;
  let lead = "";
  let follow: ReactNode = null;
  const notes: Array<{ key: string; icon: LucideIcon; body: ReactNode }> = [];

  switch (situation.kind) {
    case "grounded":
      tone = "critical";
      Icon = ShieldAlert;
      lead = t("vehicle.status.grounded.lead", {
        days: situation.days,
        report: truncate(situation.report),
      });
      follow = withNodes(
        (slots) => t(`vehicle.status.grounded.${situation.phase}`, slots),
        {
          workOrder: refLink("work_order", situation.workOrderId),
          issue: refLink("issue", situation.issueId),
        },
      );
      if (viewer.role === "FIELD_SUBMITTER" && !viewer.readOnly) {
        notes.push({
          key: "doNotDrive",
          icon: Ban,
          body: t("vehicle.status.grounded.doNotDrive"),
        });
      }
      break;
    case "available":
      tone = "success";
      Icon = ShieldCheck;
      lead = t("vehicle.status.available.lead");
      follow = availableFollow(situation, locale, t);
      break;
    case "notAssessed":
      lead = t("vehicle.status.notAssessed.lead");
      follow = t("vehicle.status.notAssessed.follow");
      break;
    case "registered":
      lead = t("vehicle.status.registered.lead");
      follow = t("vehicle.status.registered.follow");
      break;
    case "disposed":
      lead = t("vehicle.status.disposed.lead", { status: situation.status });
      follow = t("vehicle.status.disposed.follow");
      break;
  }

  // Other hard stops: an expired document is stated with its date, never as a
  // legal verdict ROUTIQ cannot make.
  for (const item of attention) {
    if (item.code !== "DOCUMENT_EXPIRED" || item.params.expiresAt === undefined) continue;
    const label = localizedLabel(
      { labelFr: item.params.documentTypeLabelFr ?? null, labelEn: item.params.documentTypeLabelEn ?? null },
      locale,
    );
    notes.push({
      key: item.subject.id,
      icon: FileExclamationPoint,
      body: withNodes(
        (slots) =>
          t("vehicle.status.alsoDocumentExpired", {
            ...slots,
            date: formatDate(item.params.expiresAt, locale),
          }),
        {
          document: (
            <LinkButton onClick={() => openRef({ kind: "document", id: item.subject.id })}>
              {label}
            </LinkButton>
          ),
        },
      ),
    });
  }

  const { step, record } = groundingStep(asset, viewer);

  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-3 rounded-xl border px-4 py-3 md:flex-row md:items-start md:gap-8",
        tone === "critical" && "border-destructive/25 bg-destructive/[0.04] dark:bg-destructive/10",
        tone === "success" && "border-success/25 bg-success/[0.05] dark:bg-success/10",
        tone === "neutral" && "bg-muted/40",
      )}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <Icon
          className={cn(
            "mt-0.5 size-5 shrink-0 md:mt-1",
            tone === "critical" && "text-destructive",
            tone === "success" && "text-success-foreground",
            tone === "neutral" && "text-muted-foreground",
          )}
          aria-hidden
        />
        <div className="min-w-0 space-y-1.5">
          <p className="text-base leading-snug text-pretty md:text-lg md:leading-snug">
            <span className="font-semibold">{lead}</span>{" "}
            {follow !== null && <span className="text-foreground/80">{follow}</span>}
          </p>
          {notes.map((note) => (
            <p key={note.key} className="flex gap-1.5 text-sm text-foreground/80">
              <note.icon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <span>{note.body}</span>
            </p>
          ))}
        </div>
      </div>
      <StatusAction step={step} record={record} />
    </div>
  );
}

function availableFollow(
  situation: Extract<Situation, { kind: "available" }>,
  locale: string,
  t: TFunction,
): string {
  const since = situation.commissionedAt === null ? null : monthYear(situation.commissionedAt, locale);
  const lastTrip = situation.lastTripAt === null ? null : formatRelativeTime(situation.lastTripAt, locale);
  if (since !== null && lastTrip !== null) {
    return t("vehicle.status.available.sinceAndTrip", { since, lastTrip });
  }
  if (since !== null) return t("vehicle.status.available.sinceNoTrips", { since });
  if (lastTrip !== null) return t("vehicle.status.available.lastTripOnly", { lastTrip });
  return t("vehicle.status.available.noTrips");
}

function StatusAction({ step, record }: { step: RoleStep; record: PanelRef | null }) {
  const { t } = useTranslation();
  const { panel } = useVehicle();
  const stepLabel = useStepLabel();
  const lockText = useLockText();
  const reasonId = useId();
  if (record === null || step.kind === "none") return null;

  if (step.kind === "go") {
    const StepIcon = STEP_ICONS[step.step.key];
    return (
      <div className="flex shrink-0 flex-col gap-1.5 pl-8 md:items-end md:pl-0">
        <Button className="h-10 md:h-9" onClick={() => panel.openStep(step.step)}>
          <StepIcon aria-hidden />
          {stepLabel(step.step)}
        </Button>
      </div>
    );
  }

  // The manager's own decision stays in view, disabled, with what it waits for;
  // the sentence already links the record.
  if (step.step.key === "release") {
    const StepIcon = STEP_ICONS.release;
    return (
      <div className="flex shrink-0 flex-col gap-1.5 pl-8 md:max-w-64 md:items-end md:pl-0">
        <Button className="h-10 md:h-9" disabled aria-describedby={reasonId}>
          <StepIcon aria-hidden />
          {stepLabel(step.step)}
        </Button>
        <p id={reasonId} className="text-xs text-muted-foreground md:text-right">
          <Lock className="mr-1 inline size-3 align-[-1px]" aria-hidden />
          {lockText(step.lock)}
        </p>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-col gap-1.5 pl-8 md:max-w-64 md:items-end md:pl-0">
      <Button variant="outline" className="h-10 bg-background md:h-9" onClick={() => panel.openRecord(record)}>
        {t("vehicle.status.openRecord", {
          kind: record.kind,
          ref: record.kind === "readings" ? "" : recordReference(record.id),
        })}
        <ArrowRight aria-hidden />
      </Button>
      <p className="text-xs text-muted-foreground md:text-right">
        <Lock className="mr-1 inline size-3 align-[-1px]" aria-hidden />
        {t("vehicle.status.lockedCaption", {
          step: stepLabel(step.step),
          reason: lockText(step.lock),
        })}
      </p>
    </div>
  );
}
