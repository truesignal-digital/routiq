import { useId, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Ban,
  CircleQuestionMark,
  FileExclamationPoint,
  Hourglass,
  Lock,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { StatusBlock as RecordStatusBlock, type StatusNote, type StatusTone } from "@/components/status-block.js";
import { Button } from "@/components/ui/button";
import { formatDate, formatRelativeTime, localizedLabel } from "@/lib/format.js";
import { contributes } from "@/modules/manifest.js";
import { useWorkOrder } from "@/maintenance/useMaintenance.js";
import { useVehicle } from "../context.js";
import { RecordNumber } from "@/components/record-number";
import { recordNumberText } from "@/lib/record-number.js";
import {
  completionSignedOff,
  groundingFacts,
  groundingStep,
  situationOf,
  vehicleRecordNumber,
  type Situation,
} from "../flow.js";
import type { PanelRef, RoleStep } from "../model.js";
import { LinkButton, useLockText, useStepLabel, withNodes } from "../parts.js";
import { STEP_ICONS } from "../steps.js";


const REPORT_MAX = 140;

/**
 * The block's sentences are short now, so a link in them is a tap target of
 * its own: 44 px on a phone, its negative margin keeping the line's height.
 */
const TARGET = "inline-flex min-h-11 items-center -my-2.5 desktop:my-0 desktop:min-h-6";

function truncate(text: string): string {
  return text.length > REPORT_MAX ? `${text.slice(0, REPORT_MAX - 1).trimEnd()}…` : text;
}

/**
 * One short sentence that says whether the vehicle may be used and what it
 * waits for, with the record that holds it, the one step this role takes next
 * beside it, and any other hard stop underneath. A quoted description is never
 * paraphrased into a grammar only English has.
 */
export function VehicleStatusBlock({ now = new Date() }: { now?: Date }) {
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
      <LinkButton className={TARGET} onClick={() => openRef({ kind, id })}>
        <RecordNumber>{recordNumberText(t, kind, vehicleRecordNumber(asset, attention, id) ?? null)}</RecordNumber>
      </LinkButton>
    );

  let tone: StatusTone = "neutral";
  let Icon: LucideIcon = CircleQuestionMark;
  let lead = "";
  let follow: ReactNode = null;
  const notes: StatusNote[] = [];

  switch (situation.kind) {
    case "grounded":
      // Amber, not red, once the repair is done and only the release is left (#92).
      tone = situation.repaired ? "waiting" : "critical";
      Icon = situation.repaired ? Hourglass : ShieldAlert;
      // The state and its age only: the record the follow links names the problem.
      lead = situation.repaired
        ? t("vehicle.status.repairedLead")
        : t("vehicle.status.grounded.lead", { days: situation.days });
      follow = withNodes(
        (slots) =>
          t(`vehicle.status.grounded.${situation.phase}`, {
            ...slots,
            count: situation.blockedBy?.count ?? 0,
            description: truncate(situation.blockedBy?.description ?? ""),
          }),
        {
          workOrder: refLink("work_order", situation.workOrderId),
          issue: refLink("issue", situation.issueId),
          otherIssue: refLink("issue", situation.blockedBy?.id),
        },
      );
      if (viewer.role === "DRIVER") {
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
      follow = availableFollow(situation, locale, t, contributes("fields", "vehicle.lastTrip", viewer.enabledModules));
      break;
    case "notAssessed":
      lead = t("vehicle.status.notAssessed.lead");
      follow = t("vehicle.status.notAssessed.follow");
      break;
    // The lead says it; the actions it rules out are locked with their reason.
    case "registered":
      lead = t("vehicle.status.registered.lead");
      break;
    case "disposed":
      lead = t("vehicle.status.disposed.lead", { status: situation.status });
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
            <LinkButton className={TARGET} onClick={() => openRef({ kind: "document", id: item.subject.id })}>
              {label}
            </LinkButton>
          ),
        },
      ),
    });
  }

  const { step, record } = groundingStep(asset, viewer);

  return (
    <RecordStatusBlock
      tone={tone}
      icon={Icon}
      lead={lead}
      follow={follow}
      notes={notes}
      action={record === null || step.kind === "none" ? undefined : <StatusAction step={step} record={record} />}
      // The truck's phone bar holds its quick actions; its decision stays in the block.
      phoneAction="inline"
    />
  );
}

function availableFollow(
  situation: Extract<Situation, { kind: "available" }>,
  locale: string,
  t: TFunction,
  tripsShown: boolean,
): string {
  // Trips' field on the vehicle (`vehicle.lastTrip`): with the module off the
  // sentence says nothing about trips rather than "none yet". Since when it is
  // in service is in Details.
  if (!tripsShown) return "";
  return situation.lastTripAt === null
    ? t("vehicle.status.available.noTrips")
    : t("vehicle.status.available.lastTripOnly", { lastTrip: formatRelativeTime(situation.lastTripAt, locale) });
}

function StatusAction({ step, record }: { step: RoleStep; record: PanelRef | null }) {
  const { t } = useTranslation();
  const { asset, attention, panel } = useVehicle();
  const stepLabel = useStepLabel();
  const lockText = useLockText();
  const reasonId = useId();
  if (record === null || step.kind === "none") return null;

  if (step.kind === "go") {
    const StepIcon = STEP_ICONS[step.step.key];
    return (
      <div className="flex flex-col gap-1.5 md:items-end">
        <Button className="desktop:h-9" onClick={() => panel.openStep(step.step)}>
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
      <div className="flex flex-col gap-1.5 md:max-w-64 md:items-end">
        <Button className="desktop:h-9" disabled aria-describedby={reasonId}>
          <StepIcon aria-hidden />
          {stepLabel(step.step)}
        </Button>
        <p id={reasonId} className="text-xs text-foreground/80 md:text-right">
          <Lock className="mr-1 inline size-3 align-[-1px]" aria-hidden />
          {lockText(step.lock)}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 md:max-w-64 md:items-end">
      <Button variant="outline" className="bg-background desktop:h-9" onClick={() => panel.openRecord(record)}>
        {t("vehicle.status.openRecord", {
          kind: record.kind,
          ref:
            record.kind === "work_order" || record.kind === "issue"
              ? recordNumberText(t, record.kind, vehicleRecordNumber(asset, attention, record.id) ?? null)
              : "",
        })}
        <ArrowRight aria-hidden />
      </Button>
      <p className="text-xs text-foreground/80 md:text-right">
        <Lock className="mr-1 inline size-3 align-[-1px]" aria-hidden />
        {t("vehicle.status.lockedCaption", {
          step: stepLabel(step.step),
          reason: lockText(step.lock),
        })}
      </p>
    </div>
  );
}
