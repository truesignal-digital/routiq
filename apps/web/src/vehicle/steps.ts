import {
  BadgeCheck,
  CircleCheck,
  CircleX,
  ClipboardX,
  Pencil,
  ReceiptText,
  ShieldX,
  type LucideIcon,
} from "lucide-react";
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
  "approve-entry": BadgeCheck,
  "reject-entry": CircleX,
  "edit-entry": Pencil,
  "add-cost": ReceiptText,
};
