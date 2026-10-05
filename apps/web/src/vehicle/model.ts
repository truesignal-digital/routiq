import type { ModuleCode, PrincipalType, Role } from "@routiq/contracts";
import type { MeContext } from "../auth/me.js";

/** The records the panel can show, each addressed by `kind:id` in the URL. */
export const PANEL_RECORD_KINDS = [
  "work_order",
  "issue",
  "entry",
  "trip",
  "document",
  "note",
] as const;
export type PanelRecordKind = (typeof PANEL_RECORD_KINDS)[number];

export type PanelRef = { kind: PanelRecordKind; id: string } | { kind: "readings" };

/** What `?panel=` accepts; anything else is dropped rather than failing the route. */
export const PANEL_PATTERN =
  /^(work_order|issue|entry|trip|document|note):[0-9a-f-]{36}$|^readings$/;

export function parsePanel(value: string | undefined): PanelRef | undefined {
  if (value === undefined || !PANEL_PATTERN.test(value)) return undefined;
  if (value === "readings") return { kind: "readings" };
  const [kind, id] = value.split(":") as [PanelRecordKind, string];
  return { kind, id };
}

export function panelParam(ref: PanelRef): string {
  return ref.kind === "readings" ? "readings" : `${ref.kind}:${ref.id}`;
}

export function samePanel(a: PanelRef | undefined, b: PanelRef | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return panelParam(a) === panelParam(b);
}

/** Every action the workspace offers; the catalogue in `actions.ts` describes each. */
export const VEHICLE_ACTION_KEYS = [
  "log-fuel",
  "record-expense",
  "attach-evidence",
  "record-reading",
  "add-note",
  "report-issue",
  "create-work-order",
  "approve-work-order",
  "complete-work-order",
  "approve-completion",
  "cancel-work-order",
  "release",
  "start-trip",
  "change-custodian",
  "transfer-branch",
  "add-document",
  "renew-document",
  "record-revenue",
  "review-entry",
  "reverse-entry",
  "commission",
] as const;
export type VehicleActionKey = (typeof VEHICLE_ACTION_KEYS)[number];

/**
 * Steps a record offers besides the catalogue's actions: the refusals and the
 * entry decisions only make sense with the record in front of you.
 */
export type StepKey =
  | VehicleActionKey
  | "reject-work-order"
  | "reject-completion"
  | "resolve-issue"
  | "dismiss-issue"
  | "approve-entry"
  | "reject-entry"
  | "edit-entry"
  | "add-cost";

/** One thing to do, on the record it is done to. */
export interface Step {
  key: StepKey;
  record?: PanelRef | undefined;
}

/** Why a step cannot be taken yet: an i18n key under `vehicle.locked` and its values. */
export type LockKey =
  | "needsAuthorization"
  | "needsCompletion"
  | "needsSignOff"
  | "needsAll"
  | "needsWorkOrder"
  | "makerCannotApprove"
  | "completerCannotSignOff"
  | "youRecordedIt"
  | "directionDecides"
  | "selfReleaseForbidden"
  | "humanOnly"
  | "notGrounded"
  | "noWorkOrderInProgress"
  | "noOpenWorkOrder"
  | "nothingAwaitingAuthorization"
  | "nothingAwaitingSignOff"
  | "nothingAwaitingReview"
  | "noEntryMissingReceipt"
  | "nothingToRenew"
  | "noRevenueCategory"
  | "alreadyInService"
  | "vehicleDisposed";

export interface Lock {
  key: LockKey;
  params?: Record<string, string | number> | undefined;
}

/** A role's own step on a record: take it, wait for a prerequisite, or nothing. */
export type RoleStep =
  | { kind: "go"; step: Step }
  | { kind: "locked"; step: Step; lock: Lock }
  | { kind: "none" };

/** A step as a row menu or a footer lists it: open, or shown with its lock. */
export interface OfferedStep {
  step: Step;
  lock?: Lock | undefined;
}

/** Who is looking: the facts every permission and lock decision reads. */
export interface Viewer {
  role: Role;
  principalId: string;
  principalType: PrincipalType;
  enabledModules: readonly ModuleCode[];
}

export function viewerOf(me: MeContext): Viewer {
  return {
    role: me.role,
    principalId: me.principalId,
    principalType: me.principalType,
    enabledModules: me.enabledModules,
  };
}

/**
 * A work order or signalement has no number of its own — the reads publish
 * only ids — so both are named by the head of the id, as the maintenance queue
 * already does (`workOrderReference`).
 */
export function recordReference(id: string): string {
  return id.slice(0, 8).toUpperCase();
}
