import type { TFunction } from "i18next";
import type { ComingUpRow, TodoRow } from "@routiq/contracts";
import {
  CalendarCheck,
  CalendarClock,
  ClipboardCheck,
  Fuel,
  ReceiptText,
  Route,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import type { ToDoItem } from "@/components/overview/to-do-list.js";
import { formatDate, formatMoney, formatMonth, formatPercent, localizedLabel } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

/** The icon's colour by how urgent the row is: safety red, warning amber, the rest muted. */
const SEVERITY_COLOUR: Record<TodoRow["severity"], string> = {
  CRITICAL: "text-destructive",
  WARNING: "text-warning-foreground",
  INFO: "text-muted-foreground",
};

export interface AttentionTarget {
  to: string;
  search?: Record<string, string>;
}

/** Where a row's one button leads. Summed rows open the list behind them across every branch, as they count. */
export function todoTarget(row: TodoRow): AttentionTarget {
  const assetId = row.asset?.id;
  switch (row.link.kind) {
    case "asset":
      return { to: `/assets/${row.link.id}` };
    case "operational_issue":
      return assetId === undefined
        ? { to: "/maintenance", search: { tab: "issues" } }
        : { to: `/assets/${assetId}/maintenance`, search: { panel: `issue:${row.link.id}` } };
    case "document":
      return assetId === undefined
        ? { to: "/assets" }
        : { to: `/assets/${assetId}/documents`, search: { panel: `document:${row.link.id}` } };
    case "approvals":
      return { to: "/finance/approve", search: { branch: "all" } };
    case "entries_evidence_missing":
      return { to: "/finance/entries", search: { evidence: "MISSING", branch: "all" } };
    case "posting_period":
      return { to: "/finance/periods" };
    case "planning":
      return { to: "/activities" };
  }
}

/**
 * One To do row in the reader's language: the server sends a code and
 * allowlisted facts, and each sentence is one message (no stitched phrases).
 */
export function todoItem(row: TodoRow, t: TFunction, locale: string | undefined): ToDoItem {
  const p = row.params;
  const key = `dashboard.todo.rows.${row.code}`;
  const money = (minor: number | undefined) =>
    minor === undefined ? "" : formatMoney(minor, { currency: p.currency ?? "XAF", ...(locale === undefined ? {} : { locale }) });
  const values = {
    asset: row.asset?.assetCode ?? "",
    days: p.days ?? 0,
    daysLeft: p.daysLeft ?? 0,
    description: p.description ?? "",
    type: localizedLabel(
      { labelFr: p.documentTypeLabelFr ?? null, labelEn: p.documentTypeLabelEn ?? null },
      locale,
    ),
    date: formatDate(p.expiresAt ?? row.since, locale),
    since: formatDate(row.since, locale),
    count: p.count ?? 0,
    amount: money(p.amountMinor),
    median: money(p.medianMinor),
    percent: p.percentAbove === undefined ? "" : formatPercent(p.percentAbove, locale),
    month: formatMonth(p.periodCode, locale),
    submitted: p.submittedCount ?? 0,
    missing: p.evidenceMissingCount ?? 0,
  };
  // Which facts exist picks the whole sentence.
  const title =
    row.code === "ISSUE_UNPLANNED" && p.safetyCritical === true ? `${key}.titleSafety` : `${key}.title`;
  // A grounded vehicle's row names the step that is next: plan, follow or release the repair.
  const groundedStage =
    row.code !== "VEHICLE_GROUNDED" ? "" : p.readyForRelease === true ? "Ready" : p.workOrderPlanned === true ? "Planned" : "";
  const detail = `${key}.detail${groundedStage}`;
  const action = `${key}.action${groundedStage}`;
  return {
    key: `${row.code}:${row.link.id ?? row.link.kind}:${p.currency ?? ""}`,
    icon: <TodoIcon row={row} />,
    title: t(title, values),
    detail: t(detail, values),
    action: { label: t(action), ...todoTarget(row) },
  };
}

function TodoIcon({ row }: { row: TodoRow }) {
  const className = cn("size-4", SEVERITY_COLOUR[row.severity]);
  switch (row.code) {
    case "VEHICLE_GROUNDED":
      return <TriangleAlert className={className} aria-hidden />;
    case "ISSUE_UNPLANNED":
      return <Wrench className={className} aria-hidden />;
    case "DOCUMENT_EXPIRED":
    case "DOCUMENT_EXPIRING":
      return <CalendarClock className={className} aria-hidden />;
    case "ENTRIES_AWAITING_APPROVAL":
      return <ClipboardCheck className={className} aria-hidden />;
    case "ENTRIES_EVIDENCE_MISSING":
      return <ReceiptText className={className} aria-hidden />;
    case "PERIOD_OPEN":
      return <CalendarCheck className={className} aria-hidden />;
    case "FUEL_PER_KM_HIGH":
      return <Fuel className={className} aria-hidden />;
  }
}

export interface ComingUpLine extends AttentionTarget {
  key: string;
  icon: "document" | "trips";
  title: string;
  detail: string;
}

/** A Coming up row in words, with the page it opens. */
export function comingUpLine(row: ComingUpRow, t: TFunction, locale: string | undefined): ComingUpLine {
  const p = row.params;
  const key = `dashboard.comingUp.rows.${row.code}`;
  const values = {
    asset: row.asset?.assetCode ?? "",
    type: localizedLabel(
      { labelFr: p.documentTypeLabelFr ?? null, labelEn: p.documentTypeLabelEn ?? null },
      locale,
    ),
    date: formatDate(row.dueDate, locale),
    days: p.daysLeft ?? 0,
    count: p.plannedCount ?? 0,
    without: p.withoutVehicleCount ?? 0,
  };
  const target: AttentionTarget =
    row.link.kind === "document" && row.asset !== null
      ? { to: `/assets/${row.asset.id}/documents`, search: { panel: `document:${row.link.id}` } }
      : { to: "/activities" };
  return {
    key: `${row.code}:${row.link.id ?? row.dueDate}`,
    icon: row.code === "DOCUMENT_DUE" ? "document" : "trips",
    title: t(`${key}.title`, values),
    detail: t(`${key}.detail`, values),
    ...target,
  };
}

export function ComingUpIcon({ icon }: { icon: ComingUpLine["icon"] }) {
  return icon === "document" ? (
    <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
  ) : (
    <Route className="size-4 text-muted-foreground" aria-hidden />
  );
}
