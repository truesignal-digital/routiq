import type { TFunction } from "i18next";
import {
  BadgeCheck,
  CircleDollarSign,
  FileText,
  Flag,
  Gauge,
  Paperclip,
  Receipt,
  Route,
  ShieldAlert,
  ShieldCheck,
  StickyNote,
  TriangleAlert,
  Undo2,
  UserRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { VehicleHistoryItem } from "@routiq/contracts";
import { historyEventLabelKey } from "@/components/record-history-sheet.js";
import { localizedLabel } from "@/lib/format.js";
import type { VehicleGates } from "./context.js";
import type { PanelRef } from "./model.js";

export type EventTone = "neutral" | "critical" | "warning" | "success";

export interface EventView {
  icon: LucideIcon;
  tone: EventTone;
  title: string;
  detail: string | null;
  /** The record the event is about, when the panel can show it to this viewer. */
  record: PanelRef | null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/**
 * An event's title is a sentence keyed by its type; its facts are the
 * allowlisted params the read carries. An event type added later still renders,
 * through the record history's label or, last, its raw code.
 */
export function describeEvent(
  item: VehicleHistoryItem,
  t: TFunction,
  locale: string,
  gates: VehicleGates,
): EventView {
  const p = item.params;
  const key = `vehicle.history.event.${item.eventType.replace(/\./g, "-")}`;
  const fallback = t(historyEventLabelKey(item.eventType), { defaultValue: item.eventType });
  const title = (values: Record<string, unknown> = {}) =>
    t(key, { defaultValue: fallback, ...values });
  const label = (fr: unknown, en: unknown) =>
    localizedLabel({ labelFr: text(fr), labelEn: text(en) }, locale);
  const subject = item.subject;

  switch (subject.entityType) {
    case "financial_entry": {
      const reversal = item.eventType === "financial_entry.reversed" || item.eventType === "financial_entry.reversal_posted";
      const evidence = item.eventType === "financial_entry.evidence_attached";
      return {
        icon: evidence
          ? Paperclip
          : reversal
            ? Undo2
            : item.eventType === "financial_entry.approved"
              ? BadgeCheck
              : p["direction"] === "REVENUE"
                ? CircleDollarSign
                : Receipt,
        tone: item.eventType === "financial_entry.rejected" ? "warning" : "neutral",
        title: title({ count: typeof p["artifactCount"] === "number" ? p["artifactCount"] : 1 }),
        detail: [text(p["entryNumber"]), label(p["categoryLabelFr"], p["categoryLabelEn"]) || null]
          .filter((part): part is string => part !== null)
          .join(" · ") || null,
        record: gates.money ? { kind: "entry", id: subject.id } : null,
      };
    }
    case "document":
      return {
        icon: FileText,
        tone: "neutral",
        title: title({ type: label(p["documentTypeLabelFr"], p["documentTypeLabelEn"]) }),
        detail: text(p["documentNumber"]),
        record: gates.documents ? { kind: "document", id: subject.id } : null,
      };
    case "activity":
      return {
        icon: Route,
        tone: "neutral",
        title: title({ number: subject.number ?? "" }),
        detail: text(p["customerName"]),
        record: gates.trips ? { kind: "trip", id: subject.id } : null,
      };
    case "movement_leg":
    case "activity_asset_segment":
      return {
        icon: Route,
        tone: "neutral",
        title: title({ number: subject.number ?? "" }),
        detail:
          text(p["originName"]) !== null && text(p["destinationName"]) !== null
            ? t("vehicle.trips.route", { from: p["originName"], to: p["destinationName"] })
            : null,
        record: null,
      };
    case "meter_reading":
      return {
        icon: Gauge,
        tone: "neutral",
        title: title({
          readingType: p["readingType"] ?? "ODOMETER",
          value: typeof p["value"] === "number" ? p["value"] : 0,
        }),
        detail: text(p["source"]) === null ? null : t(`vehicle.readings.source.${String(p["source"])}`),
        record: gates.trips ? { kind: "readings" } : null,
      };
    case "operational_issue":
      return {
        icon: TriangleAlert,
        tone: item.eventType === "operational_issue.reported" && p["safetyCritical"] === true ? "critical" : "neutral",
        title: title(),
        detail: text(p["description"]),
        record: gates.maintenance ? { kind: "issue", id: subject.id } : null,
      };
    case "work_order":
      return {
        icon: item.eventType === "work_order.asset_released" ? ShieldCheck : Wrench,
        tone: item.eventType === "work_order.asset_released" ? "success" : "neutral",
        title: title(),
        detail: text(p["description"]),
        record: gates.maintenance ? { kind: "work_order", id: subject.id } : null,
      };
    case "asset_availability_interval": {
      const opened = item.eventType === "asset_availability.opened";
      return {
        icon: opened ? ShieldAlert : ShieldCheck,
        tone: opened ? "critical" : "success",
        title: title(),
        detail: text(p["issueDescription"]),
        record: null,
      };
    }
    case "note":
      return {
        icon: StickyNote,
        tone: "neutral",
        title: title(),
        detail: text(p["body"]),
        record: { kind: "note", id: subject.id },
      };
    case "asset": {
      if (item.eventType === "asset.assigned") {
        const branch = text(p["branchCode"]);
        const previousBranch = text(p["previousBranchCode"]);
        const custodian = text(p["custodianDisplayName"]);
        const previousCustodian = text(p["previousCustodianDisplayName"]);
        const change =
          branch !== null && branch !== previousBranch
            ? "branch"
            : custodian !== null
              ? "custodian"
              : previousCustodian !== null
                ? "cleared"
                : "other";
        return {
          icon: UserRound,
          tone: "neutral",
          title: title({ change, branch: branch ?? "", custodian: custodian ?? "" }),
          detail: null,
          record: null,
        };
      }
      return { icon: Flag, tone: "neutral", title: title(), detail: null, record: null };
    }
    default:
      return { icon: Flag, tone: "neutral", title: title(), detail: null, record: null };
  }
}
