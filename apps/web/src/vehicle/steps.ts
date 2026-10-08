import {
  BadgeCheck,
  CircleCheck,
  CircleX,
  ClipboardX,
  Eye,
  Pencil,
  ReceiptText,
  ShieldAlert,
  ShieldOff,
  ShieldX,
  type LucideIcon,
} from "lucide-react";
import type { CommandLabelRef } from "../commands/labels.js";
import { VEHICLE_ACTIONS } from "./actions.js";
import type { StepKey, VehicleActionKey } from "./model.js";

const ACTION_ICONS = Object.fromEntries(
  VEHICLE_ACTIONS.map((action) => [action.key, action.icon]),
) as Record<VehicleActionKey, LucideIcon>;

/** The glyph a step carries in menus, footers and buttons. */
export const STEP_ICONS: Record<StepKey, LucideIcon> = {
  ...ACTION_ICONS,
  "reject-work-order": ShieldX,
  "reject-completion": ClipboardX,
  "resolve-issue": CircleCheck,
  "dismiss-issue": CircleX,
  "raise-severity": ShieldAlert,
  "lower-severity": ShieldOff,
  "approve-entry": BadgeCheck,
  "reject-entry": CircleX,
  "edit-entry": Pencil,
  "add-cost": ReceiptText,
  "acknowledge-note": Eye,
};

/**
 * The command behind each step, whose words name it in the header, the quick
 * bar, the sheet, menus and footers alike. Reviewing an entry only opens it;
 * the approve or reject that follows is its own step.
 */
export const STEP_COMMANDS: Record<Exclude<StepKey, "review-entry">, CommandLabelRef> = {
  "log-fuel": { command: "record-expense", intent: "fuel" },
  "record-expense": "record-expense",
  "attach-evidence": "attach-evidence",
  "record-reading": "record-meter-reading",
  "add-note": "add-note",
  "report-issue": "report-issue",
  "create-work-order": "create-work-order",
  "approve-work-order": "approve-work-order",
  "complete-work-order": "complete-work-order",
  "approve-completion": "approve-work-order-closure",
  "cancel-work-order": "cancel-work-order",
  release: "release-asset-to-service",
  "start-trip": "record-journey-sheet",
  "change-custodian": { command: "assign-asset", intent: "custodian" },
  "transfer-branch": "assign-asset",
  "add-document": "add-or-renew-document",
  "renew-document": { command: "add-or-renew-document", intent: "renew" },
  "record-revenue": "record-revenue",
  "reverse-entry": "reverse-entry",
  commission: "commission-asset",
  "reject-work-order": "reject-work-order",
  "reject-completion": "reject-work-order-completion",
  "resolve-issue": "resolve-issue",
  "dismiss-issue": "dismiss-issue",
  "raise-severity": "change-issue-severity",
  "lower-severity": { command: "change-issue-severity", intent: "lower" },
  "approve-entry": "approve-entry",
  "reject-entry": "reject-entry",
  "edit-entry": "update-pending-entry",
  "add-cost": "record-expense",
  "acknowledge-note": "acknowledge-note",
};

/** Steps that refuse or cancel: their buttons take the destructive variant. */
export const DESTRUCTIVE_STEPS: ReadonlySet<StepKey> = new Set([
  "cancel-work-order",
  "reject-work-order",
  "reject-completion",
  "dismiss-issue",
  "lower-severity",
  "reject-entry",
  "reverse-entry",
]);
