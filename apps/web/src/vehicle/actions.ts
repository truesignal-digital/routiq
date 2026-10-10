import {
  LEDGER_READER_ROLES,
  type AssetAttentionItem,
  type AssetDetail,
  type AttentionCode,
  type Role,
} from "@routiq/contracts";
import {
  ArrowLeftRight,
  BadgeCheck,
  Ban,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardPlus,
  FileCheck2,
  FilePlus2,
  Fuel,
  Gauge,
  Paperclip,
  PlayCircle,
  Receipt,
  Route,
  ShieldCheck,
  StickyNote,
  TriangleAlert,
  Undo2,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { contributes } from "../modules/manifest.js";
import { groundingFacts, isDisposed, releaseBlocker, releaseLockFor } from "./flow.js";
import {
  recordReference,
  type Lock,
  type LockKey,
  type PanelRef,
  type Viewer,
  type VehicleActionKey,
} from "./model.js";

/**
 * The production action catalogue: every action a vehicle offers, who may take
 * it, and whether this vehicle allows it right now (the owning module names its
 * actions in its manifest, `src/modules/`). Only
 * built commands appear. Labels and descriptions live in i18n under
 * `vehicle.actions.<key>`.
 */

export const ACTION_GROUPS = [
  "capture",
  "maintenance",
  "operations",
  "documents",
  "money",
  "lifecycle",
] as const;
export type ActionGroup = (typeof ACTION_GROUPS)[number];

/**
 * How an action opens. `form` is a record-less form in the panel; `record` and
 * `record-form` open the record the action is about (with its form on top for
 * the latter) — when the vehicle has one, else the action is locked;
 * `navigate` leaves the panel for a screen or a tab.
 */
export type ActionOpen = "form" | "record" | "record-form" | "navigate";

export interface VehicleActionDef {
  key: VehicleActionKey;
  group: ActionGroup;
  icon: LucideIcon;
  /** The roles the command's default rules accept, as the permission helpers list them. */
  roles: readonly Role[];
  open: ActionOpen;
}

const EXPENSE_WRITERS = ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER", "DRIVER"] as const;
const REVENUE_WRITERS = ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER"] as const;
const WORKSHOP = ["DIRECTOR", "ADMIN", "TECHNICIAN"] as const;
const WORK_ORDER_DECIDERS = ["DIRECTOR", "ADMIN"] as const;
const ENTRY_DECIDERS = ["DIRECTOR", "FINANCE"] as const;
const MANAGERS = ["DIRECTOR", "ADMIN"] as const;
const TRIP_RUNNERS = ["DIRECTOR", "ADMIN", "DRIVER"] as const;
const DOCUMENT_KEEPERS = ["DIRECTOR", "ADMIN", "FINANCE"] as const;
const FIELD_REPORTERS = ["DIRECTOR", "ADMIN", "TECHNICIAN", "DRIVER"] as const;

export const VEHICLE_ACTIONS: readonly VehicleActionDef[] = [
  { key: "log-fuel", group: "capture", icon: Fuel, roles: EXPENSE_WRITERS, open: "form" },
  { key: "record-expense", group: "capture", icon: Receipt, roles: EXPENSE_WRITERS, open: "form" },
  // Every role may attach, but on the vehicle only the ledger readers see
  // entries to attach to; the workshop reaches its own through work orders.
  { key: "attach-evidence", group: "capture", icon: Paperclip, roles: LEDGER_READER_ROLES, open: "record-form" },
  {
    key: "record-reading",
    group: "capture",
    icon: Gauge,
   
    roles: FIELD_REPORTERS,
    open: "form",
  },
  {
    key: "add-note",
    group: "capture",
    icon: StickyNote,
   
    roles: ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"],
    open: "form",
  },
  {
    key: "report-issue",
    group: "maintenance",
    icon: TriangleAlert,
    roles: FIELD_REPORTERS,
    open: "form",
  },
  { key: "create-work-order", group: "maintenance", icon: ClipboardPlus, roles: WORKSHOP, open: "form" },
  { key: "approve-work-order", group: "maintenance", icon: BadgeCheck, roles: WORK_ORDER_DECIDERS, open: "record-form" },
  { key: "complete-work-order", group: "maintenance", icon: ClipboardCheck, roles: WORKSHOP, open: "record-form" },
  { key: "approve-completion", group: "maintenance", icon: ClipboardCheck, roles: WORK_ORDER_DECIDERS, open: "record-form" },
  { key: "cancel-work-order", group: "maintenance", icon: Ban, roles: WORKSHOP, open: "record-form" },
  { key: "release", group: "maintenance", icon: ShieldCheck, roles: MANAGERS, open: "record-form" },
  { key: "start-trip", group: "operations", icon: Route, roles: TRIP_RUNNERS, open: "navigate" },
  { key: "change-custodian", group: "operations", icon: UserRound, roles: MANAGERS, open: "form" },
  {
    key: "transfer-branch",
    group: "operations",
    icon: ArrowLeftRight,
   
    roles: ["DIRECTOR", "ADMIN", "FINANCE"],
    open: "form",
  },
  { key: "add-document", group: "documents", icon: FilePlus2, roles: DOCUMENT_KEEPERS, open: "form" },
  { key: "renew-document", group: "documents", icon: FileCheck2, roles: DOCUMENT_KEEPERS, open: "record-form" },
  { key: "record-revenue", group: "money", icon: CircleDollarSign, roles: REVENUE_WRITERS, open: "form" },
  { key: "review-entry", group: "money", icon: BadgeCheck, roles: ENTRY_DECIDERS, open: "record" },
  { key: "reverse-entry", group: "money", icon: Undo2, roles: ENTRY_DECIDERS, open: "navigate" },
  { key: "commission", group: "lifecycle", icon: PlayCircle, roles: MANAGERS, open: "form" },
];

export function actionDef(key: VehicleActionKey): VehicleActionDef {
  const def = VEHICLE_ACTIONS.find((action) => action.key === key);
  if (def === undefined) throw new Error(`Unknown vehicle action ${key}`);
  return def;
}

/** Role and module: whether the action exists for this viewer at all. */
export function actionPermitted(def: VehicleActionDef, viewer: Viewer): boolean {
  if (!contributes("vehicleActions", def.key, viewer.enabledModules)) return false;
  return def.roles.includes(viewer.role);
}

export function permittedActions(viewer: Viewer): VehicleActionDef[] {
  return VEHICLE_ACTIONS.filter((def) => actionPermitted(def, viewer));
}

/** What the vehicle's own state says about an action: go (and on which record), or why not. */
export type ActionAvailability =
  | { state: "enabled"; target?: PanelRef | undefined }
  | { state: "locked"; lock: Lock };

export interface VehicleFacts {
  asset: AssetDetail;
  /** The attention read; empty while it loads, which only ever locks, never unlocks. */
  attention: readonly AssetAttentionItem[];
  /** Active revenue categories; undefined while unknown. */
  revenueCategoryCount?: number | undefined;
}

const enabled = (target?: PanelRef): ActionAvailability => ({ state: "enabled", target });
const locked = (lock: Lock): ActionAvailability => ({ state: "locked", lock });

function itemsOf(facts: VehicleFacts, code: AttentionCode) {
  return facts.attention.filter((item) => item.code === code);
}

function recordOf(item: AssetAttentionItem): PanelRef {
  const { entityType, id } = item.subject;
  if (entityType === "work_order") return { kind: "work_order", id };
  if (entityType === "operational_issue") return { kind: "issue", id };
  if (entityType === "document") return { kind: "document", id };
  return { kind: "entry", id };
}

/**
 * A decision someone else must take: the first item the viewer did not make,
 * else locked with the maker reason, else locked because nothing waits.
 */
function decision(
  items: readonly AssetAttentionItem[],
  viewer: Viewer,
  makerLock: LockKey,
  noneLock: LockKey,
): ActionAvailability {
  const first = items[0];
  if (first === undefined) return locked({ key: noneLock });
  const open = items.find((item) => !item.makerPrincipalIds.includes(viewer.principalId));
  if (open !== undefined) return enabled(recordOf(open));
  return locked({ key: makerLock, params: { ref: recordReference(first.subject.id) } });
}

/**
 * Availability of one action on this vehicle, for this viewer. The facts are
 * the detail and the attention read only (PLAN §4), so the header, the sheet
 * and the phone bar agree without loading any tab's data.
 */
export function actionAvailability(
  key: VehicleActionKey,
  facts: VehicleFacts,
  viewer: Viewer,
): ActionAvailability {
  const { asset } = facts;
  if (isDisposed(asset) && key !== "reverse-entry" && key !== "review-entry") {
    return locked({ key: "vehicleDisposed" });
  }
  const grounding = groundingFacts(asset);

  switch (key) {
    case "record-revenue":
      return facts.revenueCategoryCount === 0 ? locked({ key: "noRevenueCategory" }) : enabled();
    case "create-work-order": {
      const unplanned = itemsOf(facts, "ISSUE_UNPLANNED")[0];
      return enabled(unplanned === undefined ? undefined : recordOf(unplanned));
    }
    case "approve-work-order":
      return decision(
        itemsOf(facts, "WORK_ORDER_AWAITING_AUTHORIZATION"),
        viewer,
        "makerCannotApprove",
        "nothingAwaitingAuthorization",
      );
    case "approve-completion":
      return decision(
        itemsOf(facts, "WORK_ORDER_AWAITING_SIGN_OFF"),
        viewer,
        "completerCannotSignOff",
        "nothingAwaitingSignOff",
      );
    case "complete-work-order": {
      const groundingOrder = grounding?.workOrder;
      if (groundingOrder?.status === "APPROVED") {
        return enabled({ kind: "work_order", id: groundingOrder.id });
      }
      const inProgress = itemsOf(facts, "WORK_ORDER_IN_PROGRESS")[0];
      return inProgress === undefined
        ? locked({ key: "noWorkOrderInProgress" })
        : enabled(recordOf(inProgress));
    }
    case "cancel-work-order": {
      const groundingOrder = grounding?.workOrder;
      if (groundingOrder !== undefined && groundingOrder.status !== "COMPLETED") {
        return enabled({ kind: "work_order", id: groundingOrder.id });
      }
      const open = facts.attention.find(
        (item) =>
          item.code === "WORK_ORDER_IN_PROGRESS" ||
          item.code === "WORK_ORDER_AWAITING_AUTHORIZATION" ||
          item.code === "WORK_ORDER_AWAITING_SIGN_OFF",
      );
      return open === undefined ? locked({ key: "noOpenWorkOrder" }) : enabled(recordOf(open));
    }
    case "release": {
      const blocker = releaseBlocker(grounding);
      if (blocker !== undefined || grounding === undefined) {
        return locked(blocker ?? { key: "notGrounded" });
      }
      const lock = releaseLockFor(grounding, viewer);
      if (lock !== undefined) return locked(lock);
      return enabled(
        grounding.workOrder !== undefined
          ? { kind: "work_order", id: grounding.workOrder.id }
          : { kind: "issue", id: grounding.grounded.issue.id },
      );
    }
    case "renew-document": {
      const due =
        itemsOf(facts, "DOCUMENT_EXPIRED")[0] ?? itemsOf(facts, "DOCUMENT_EXPIRING")[0];
      return due === undefined ? locked({ key: "nothingToRenew" }) : enabled(recordOf(due));
    }
    case "review-entry":
      return decision(
        itemsOf(facts, "ENTRY_AWAITING_REVIEW"),
        viewer,
        "youRecordedIt",
        "nothingAwaitingReview",
      );
    case "attach-evidence": {
      const missing = itemsOf(facts, "ENTRY_EVIDENCE_MISSING")[0];
      return missing === undefined
        ? locked({ key: "noEntryMissingReceipt" })
        : enabled(recordOf(missing));
    }
    case "commission":
      return asset.lifecycleStatus === "REGISTERED"
        ? enabled()
        : locked({ key: "alreadyInService" });
    case "log-fuel":
    case "record-expense":
    case "record-reading":
    case "add-note":
    case "report-issue":
    case "start-trip":
    case "change-custodian":
    case "transfer-branch":
    case "add-document":
    case "reverse-entry":
      return enabled();
  }
}

/** The identity strip's buttons: what this role does most, nothing else. */
export const HEADER_ACTIONS: Record<Role, readonly VehicleActionKey[]> = {
  DIRECTOR: ["record-expense"],
  ADMIN: ["record-expense"],
  FINANCE: ["record-expense"],
  CASHIER: ["record-expense"],
  TECHNICIAN: ["report-issue"],
  DRIVER: ["log-fuel", "report-issue"],
};

/** The phone bar: the first three of these this role can take right now, then More. */
export const QUICK_ACTIONS: Record<Role, readonly VehicleActionKey[]> = {
  DIRECTOR: ["review-entry", "record-expense", "report-issue", "start-trip"],
  ADMIN: ["record-expense", "report-issue", "start-trip", "renew-document"],
  FINANCE: ["review-entry", "record-expense", "attach-evidence", "reverse-entry"],
  CASHIER: ["record-expense", "record-revenue", "add-note"],
  TECHNICIAN: ["complete-work-order", "create-work-order", "report-issue", "add-note"],
  DRIVER: ["log-fuel", "report-issue", "record-reading", "start-trip"],
};

/** The all-actions sheet lists the role's own area first. */
export const GROUP_FIRST: Record<Role, ActionGroup | null> = {
  DIRECTOR: null,
  ADMIN: null,
  FINANCE: "money",
  CASHIER: "money",
  TECHNICIAN: "maintenance",
  DRIVER: "capture",
};

export function headerActions(viewer: Viewer): VehicleActionKey[] {
  return HEADER_ACTIONS[viewer.role].filter((key) => actionPermitted(actionDef(key), viewer));
}

export function quickActions(facts: VehicleFacts, viewer: Viewer): VehicleActionKey[] {
  return QUICK_ACTIONS[viewer.role]
    .filter(
      (key) =>
        actionPermitted(actionDef(key), viewer) &&
        actionAvailability(key, facts, viewer).state === "enabled",
    )
    .slice(0, 3);
}

/** Permitted actions grouped for the sheet, the role's own group first. */
export function groupedActions(viewer: Viewer): Array<{ group: ActionGroup; actions: VehicleActionDef[] }> {
  const permitted = permittedActions(viewer);
  const first = GROUP_FIRST[viewer.role];
  const order = first === null ? ACTION_GROUPS : [first, ...ACTION_GROUPS.filter((g) => g !== first)];
  return order
    .map((group) => ({ group, actions: permitted.filter((def) => def.group === group) }))
    .filter((entry) => entry.actions.length > 0);
}
