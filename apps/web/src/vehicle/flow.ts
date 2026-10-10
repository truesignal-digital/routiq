import type {
  AssetAttentionItem,
  AssetAvailability,
  AssetDetail,
  AvailabilityWorkOrder,
  HistoryActor,
  WorkOrderStatus,
} from "@routiq/contracts";
import { canManageDocuments } from "../documents/permissions.js";
import {
  canAddWorkOrderCost,
  canApproveEntries,
  canAttachEvidence,
  canEditPendingEntry,
  canReverseEntry,
} from "../finance/permissions.js";
import {
  canApproveWorkOrders,
  canDismissIssues,
  canLowerIssueSeverity,
  canManageWorkOrders,
  canRaiseIssueSeverity,
  canReleaseAssets,
  canResolveIssues,
} from "../maintenance/permissions.js";
import { isActiveWorkOrder } from "../maintenance/status.js";
import type { NumberedRecord } from "../lib/record-number.js";
import {
  type Lock,
  type OfferedStep,
  type PanelRef,
  type RoleStep,
  type Step,
  type StepKey,
  type Viewer,
} from "./model.js";

/**
 * The problem → work order → sign-off → release flow, read off the real
 * records: who takes the next step, and what the others are waiting for. Pure
 * functions over the reads, so every rule here is unit-tested without a screen.
 */

export type Grounded = Extract<AssetAvailability, { state: "GROUNDED" }>;

export { isActiveWorkOrder };

const DISPOSED = ["SOLD", "RETIRED", "WRITTEN_OFF"] as const;
type DisposedStatus = (typeof DISPOSED)[number];

export function isDisposed(asset: Pick<AssetDetail, "lifecycleStatus">): boolean {
  return (DISPOSED as readonly string[]).includes(asset.lifecycleStatus);
}

export interface GroundingFacts {
  grounded: Grounded;
  /** The work order answering the grounding: the one in progress, else the completed one. */
  workOrder: AvailabilityWorkOrder | undefined;
  /** With nothing in progress or done, the newest refusal, so the sentence can say so. */
  refused: AvailabilityWorkOrder | undefined;
}

export function groundingFacts(asset: Pick<AssetDetail, "availability">): GroundingFacts | undefined {
  const availability = asset.availability;
  if (availability.state !== "GROUNDED") return undefined;
  // Newest first on the read, so the first match is the current one.
  const active = availability.workOrders.find((wo) => isActiveWorkOrder(wo.status));
  const completed = availability.workOrders.find((wo) => wo.status === "COMPLETED");
  const workOrder = active ?? completed;
  const refused =
    workOrder === undefined
      ? availability.workOrders.find((wo) => wo.status === "REJECTED")
      : undefined;
  return { grounded: availability, workOrder, refused };
}

/**
 * A work order's or problem's number from what the vehicle's reads already
 * carry (#608): the grounding and the attention items. Undefined when neither
 * names the record, so a caller can tell "not here" from "not numbered yet".
 */
export function vehicleRecordNumber(
  asset: Pick<AssetDetail, "availability">,
  attention: readonly AssetAttentionItem[],
  id: string,
): number | null | undefined {
  const availability = asset.availability;
  if (availability.state === "GROUNDED") {
    if (availability.issue.id === id) return availability.issue.number;
    const known = [...availability.workOrders, ...availability.otherOpenSafetyIssues].find((row) => row.id === id);
    if (known !== undefined) return known.number;
  }
  const item = attention.find((candidate) => candidate.subject.id === id);
  return item === undefined ? undefined : (item.params.recordNumber ?? null);
}

const same = (actor: HistoryActor | null | undefined, viewer: Viewer) =>
  actor?.principalId != null && actor.principalId === viewer.principalId;

/**
 * A receipt on this entry: TECHNICIAN and DRIVER only on entries they recorded
 * (server: OWN_RECORDS_ONLY), everyone else who may attach on any.
 */
const mayAttachTo = (recordedBy: HistoryActor | null | undefined, viewer: Viewer) =>
  may.attachEvidence(viewer) &&
  ((viewer.role !== "DRIVER" && viewer.role !== "TECHNICIAN") || same(recordedBy, viewer));

const may = {
  manageWorkOrders: (v: Viewer) => canManageWorkOrders(v.role, v.enabledModules),
  approveWorkOrders: (v: Viewer) => canApproveWorkOrders(v.role, v.enabledModules),
  release: (v: Viewer) => canReleaseAssets(v.role, v.enabledModules),
  resolveIssues: (v: Viewer) => canResolveIssues(v.role, v.enabledModules),
  dismissIssues: (v: Viewer) => canDismissIssues(v.role, v.enabledModules),
  raiseSeverity: (v: Viewer) => canRaiseIssueSeverity(v.role, v.enabledModules),
  lowerSeverity: (v: Viewer) => canLowerIssueSeverity(v.role, v.enabledModules),
  addCost: (v: Viewer) => canAddWorkOrderCost(v.role, v.enabledModules),
  approveEntries: (v: Viewer) => canApproveEntries(v.role, v.enabledModules),
  attachEvidence: (v: Viewer) => canAttachEvidence(v.role, v.enabledModules),
  renewDocuments: (v: Viewer) => canManageDocuments(v.role, v.enabledModules),
};

export { may };

/**
 * What stops THIS viewer from releasing, once the flow allows it: the dispatcher
 * takes decisions from humans only, and after a safety-critical report nobody
 * who vouched the fault gone may also release (SELF_RELEASE_FORBIDDEN).
 */
export function releaseLockFor(facts: GroundingFacts, viewer: Viewer): Lock | undefined {
  if (viewer.principalType !== "HUMAN") return { key: "humanOnly" };
  const { issue } = facts.grounded;
  if (!issue.safetyCritical) return undefined;
  const vouched =
    facts.workOrder?.status === "COMPLETED"
      ? same(facts.workOrder.completedBy, viewer)
      : same(issue.closedBy, viewer);
  return vouched ? { key: "selfReleaseForbidden" } : undefined;
}

/**
 * What the flow still needs before anyone can release, or nothing when it is
 * ready. In the server's order (release-asset-to-service.ts): the repair, then
 * every other safety-critical problem closed (SAFETY_ISSUE_OPEN).
 */
export function releaseBlocker(facts: GroundingFacts | undefined): Lock | undefined {
  if (facts === undefined) return { key: "notGrounded" };
  const wo = facts.workOrder;
  if (wo !== undefined) {
    const ref = workOrderRef(wo);
    if (wo.status === "SUBMITTED") return { key: "needsAll", ref };
    // Not "and signed off": a completion inside the auto band lands COMPLETED directly.
    if (wo.status === "APPROVED") return { key: "needsCompletion", ref };
    if (wo.status === "COMPLETION_SUBMITTED") return { key: "needsSignOff", ref };
  } else if (facts.grounded.issue.status === "OPEN") {
    // No work order: only a signalement closed as dealt with lets a release through.
    return { key: "needsWorkOrder" };
  }
  const others = facts.grounded.otherOpenSafetyIssues;
  const [first] = others;
  return first === undefined
    ? undefined
    : { key: "otherSafetyIssueOpen", params: { count: others.length, description: first.description } };
}

/** Everything that stops this viewer releasing now: the flow first, then who they are. */
function releaseLock(facts: GroundingFacts, viewer: Viewer): Lock | undefined {
  return releaseBlocker(facts) ?? releaseLockFor(facts, viewer);
}

/** A work order as a lock reason names it: by its number (#608). */
const workOrderRef = (wo: { number: number | null }): NumberedRecord => ({ kind: "work_order", number: wo.number });

/** The fields of a work order the flow reads; both the list row and the grounding carry them. */
export interface WorkOrderFacts {
  id: string;
  number: number | null;
  status: WorkOrderStatus;
  createdBy: HistoryActor;
  completedBy: HistoryActor | null;
}

export interface RecordSteps {
  /** This role's own next step, or the prerequisite it waits for. */
  primary: RoleStep;
  /** Every step the role may take on the record, locked ones with their reason. */
  offered: OfferedStep[];
}

/**
 * A work order's steps for one viewer. `grounding` is set when the order is the
 * one keeping the vehicle off the road: only then does its completion lead to a
 * release.
 */
export function workOrderSteps(
  wo: WorkOrderFacts,
  viewer: Viewer,
  grounding?: GroundingFacts | undefined,
): RecordSteps {
  const record: PanelRef = { kind: "work_order", id: wo.id };
  const step = (key: StepKey): Step => ({ key, record });
  const offered: OfferedStep[] = [];
  const offer = (key: StepKey, lock?: Lock) => offered.push({ step: step(key), lock });
  const isGrounding = grounding !== undefined && grounding.workOrder?.id === wo.id;
  const managing = may.manageWorkOrders(viewer);
  const approving = may.approveWorkOrders(viewer);
  const releasing = isGrounding && may.release(viewer);
  let primary: RoleStep = { kind: "none" };

  switch (wo.status) {
    case "SUBMITTED": {
      const makerLock: Lock | undefined = same(wo.createdBy, viewer)
        ? { key: "makerCannotApprove", ref: workOrderRef(wo) }
        : undefined;
      if (approving) {
        offer("approve-work-order", makerLock);
        offer("reject-work-order", makerLock);
        primary = makerLock
          ? { kind: "locked", step: step("approve-work-order"), lock: makerLock }
          : { kind: "go", step: step("approve-work-order") };
      } else if (managing) {
        primary = {
          kind: "locked",
          step: step("complete-work-order"),
          lock: { key: "needsAuthorization", ref: workOrderRef(wo) },
        };
      } else if (releasing) {
        primary = {
          kind: "locked",
          step: step("release"),
          lock: { key: "needsAll", ref: workOrderRef(wo) },
        };
      }
      if (managing) offer("cancel-work-order");
      break;
    }
    case "APPROVED": {
      if (managing) {
        offer("complete-work-order");
        primary = { kind: "go", step: step("complete-work-order") };
      } else if (approving) {
        primary = {
          kind: "locked",
          step: step("approve-completion"),
          lock: { key: "needsCompletion", ref: workOrderRef(wo) },
        };
      } else if (releasing) {
        primary = {
          kind: "locked",
          step: step("release"),
          lock: { key: "needsCompletion", ref: workOrderRef(wo) },
        };
      }
      // Costs attach to open work, and to completed work for the late invoice
      // (#82); WORK_ORDER_NOT_OPEN otherwise.
      if (may.addCost(viewer)) offer("add-cost");
      if (managing) offer("cancel-work-order");
      break;
    }
    case "COMPLETION_SUBMITTED": {
      const completerLock: Lock | undefined = same(wo.completedBy, viewer)
        ? { key: "completerCannotSignOff", ref: workOrderRef(wo) }
        : undefined;
      if (approving) {
        offer("approve-completion", completerLock);
        offer("reject-completion", completerLock);
        primary = completerLock
          ? { kind: "locked", step: step("approve-completion"), lock: completerLock }
          : { kind: "go", step: step("approve-completion") };
      } else if (releasing) {
        primary = {
          kind: "locked",
          step: step("release"),
          lock: { key: "needsSignOff", ref: workOrderRef(wo) },
        };
      }
      if (managing) offer("cancel-work-order");
      break;
    }
    case "COMPLETED": {
      if (releasing && grounding !== undefined) {
        const lock = releaseLock(grounding, viewer);
        offer("release", lock);
        primary = lock
          ? { kind: "locked", step: step("release"), lock }
          : { kind: "go", step: step("release") };
      }
      // The invoice that arrives after the close; it always waits for review (#82).
      if (may.addCost(viewer)) offer("add-cost");
      break;
    }
    case "REJECTED":
    case "CANCELLED":
      break;
  }
  return { primary, offered };
}

/** Why the work order is stopped, from the viewer's side: who it is waiting on. */
export type WorkOrderWaiting = "authorization" | "completion" | "signOff" | "release" | "otherSafetyIssue";

/**
 * `otherSafetyIssueOpen`: another safety-critical problem on the vehicle is
 * still open, which blocks the release before any manager can act (#588, the
 * server's SAFETY_ISSUE_OPEN).
 */
export function workOrderWaiting(
  status: WorkOrderStatus,
  isGrounding: boolean,
  otherSafetyIssueOpen = false,
): WorkOrderWaiting | null {
  switch (status) {
    case "SUBMITTED":
      return "authorization";
    case "APPROVED":
      return "completion";
    case "COMPLETION_SUBMITTED":
      return "signOff";
    case "COMPLETED":
      if (!isGrounding) return null;
      return otherSafetyIssueOpen ? "otherSafetyIssue" : "release";
    case "REJECTED":
    case "CANCELLED":
      return null;
  }
}

export interface IssueFacts {
  id: string;
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  safetyCritical: boolean;
  /** A work order still in the flow answers it, so it is not "unplanned". */
  planned: boolean;
}

export function issueSteps(
  issue: IssueFacts,
  viewer: Viewer,
  grounding?: GroundingFacts | undefined,
): RecordSteps {
  const record: PanelRef = { kind: "issue", id: issue.id };
  const offered: OfferedStep[] = [];
  let primary: RoleStep = { kind: "none" };
  const isGroundingIssue = grounding?.grounded.issue.id === issue.id;

  if (issue.status === "OPEN") {
    if (!issue.planned && may.manageWorkOrders(viewer)) {
      const step: Step = { key: "create-work-order", record };
      offered.push({ step });
      primary = { kind: "go", step };
    }
    if (may.resolveIssues(viewer)) offered.push({ step: { key: "resolve-issue", record } });
    if (may.dismissIssues(viewer)) offered.push({ step: { key: "dismiss-issue", record } });
    // The mark can be added by whoever reports, taken off by the managers (#96).
    if (!issue.safetyCritical && may.raiseSeverity(viewer)) {
      offered.push({ step: { key: "raise-severity", record } });
    }
    if (issue.safetyCritical && may.lowerSeverity(viewer)) {
      offered.push({ step: { key: "lower-severity", record } });
    }
  } else if (
    isGroundingIssue &&
    grounding !== undefined &&
    grounding.workOrder === undefined &&
    may.release(viewer)
  ) {
    // Closed without a repair: the override release stands on the signalement.
    const lock = releaseLock(grounding, viewer);
    const step: Step = { key: "release", record };
    offered.push({ step, lock });
    primary = lock ? { kind: "locked", step, lock } : { kind: "go", step };
  }
  return { primary, offered };
}

/** The entry fields its steps read, from the list row or the detail. */
export interface EntryFacts {
  id: string;
  status: "SUBMITTED" | "POSTED" | "REJECTED" | "REVERSED";
  direction: "EXPENSE" | "REVENUE";
  reversesEntryId: string | null;
  recordedBy: HistoryActor;
  evidence: { state: "SUPPLIED" | "PAYMENT_REFERENCE" | "NOT_EXPECTED" | "NOT_SUPPLIED" };
  /** The detail's word that the viewer's role may not decide it (above its band). */
  directionDecides?: boolean;
}

/** A reversal never needs paperwork of its own, and a refused spend needs none at all. */
export function missingReceipt(entry: EntryFacts): boolean {
  return (
    entry.evidence.state === "NOT_SUPPLIED" &&
    entry.reversesEntryId === null &&
    entry.status !== "REJECTED" &&
    entry.status !== "REVERSED"
  );
}

export function entrySteps(entry: EntryFacts, viewer: Viewer): RecordSteps {
  const record: PanelRef = { kind: "entry", id: entry.id };
  const offered: OfferedStep[] = [];
  let primary: RoleStep = { kind: "none" };

  if (missingReceipt(entry) && mayAttachTo(entry.recordedBy, viewer)) {
    const step: Step = { key: "attach-evidence", record };
    offered.push({ step });
    primary = { kind: "go", step };
  }
  // The author alone, while it waits (#85); anyone else rejects it instead.
  if (canEditPendingEntry(entry, viewer)) {
    offered.push({ step: { key: "edit-entry", record } });
  }
  if (entry.status === "SUBMITTED" && may.approveEntries(viewer)) {
    const lock: Lock | undefined = same(entry.recordedBy, viewer)
      ? { key: "youRecordedIt" }
      : entry.directionDecides === true
        ? { key: "directionDecides" }
        : undefined;
    offered.push({ step: { key: "approve-entry", record }, lock });
    offered.push({ step: { key: "reject-entry", record }, lock });
    if (!lock) primary = { kind: "go", step: { key: "approve-entry", record } };
    else if (primary.kind === "none") {
      primary = { kind: "locked", step: { key: "approve-entry", record }, lock };
    }
  }
  // An entry's panel opens only while Money is on (its manifest owns the panel).
  if (canReverseEntry(viewer.role, entry)) {
    offered.push({ step: { key: "reverse-entry", record } });
  }
  return { primary, offered };
}

/**
 * The step beside the status sentence, and the record it acts on. A manager's
 * headline is always the release — the decision only they take — locked with
 * what it still needs until the flow allows it; their workshop and approval
 * steps stay on the work order and in the actions sheet.
 */
export function groundingStep(
  asset: Pick<AssetDetail, "availability">,
  viewer: Viewer,
): { step: RoleStep; record: PanelRef | null } {
  const facts = groundingFacts(asset);
  if (facts === undefined) return { step: { kind: "none" }, record: null };
  const wo = facts.workOrder;
  if (may.release(viewer)) {
    const record: PanelRef =
      wo !== undefined ? { kind: "work_order", id: wo.id } : { kind: "issue", id: facts.grounded.issue.id };
    const step: Step = { key: "release", record };
    const lock = releaseLock(facts, viewer);
    return { step: lock ? { kind: "locked", step, lock } : { kind: "go", step }, record };
  }
  if (wo !== undefined) {
    return {
      step: workOrderSteps(wo, viewer, facts).primary,
      record: { kind: "work_order", id: wo.id },
    };
  }
  const issue = facts.grounded.issue;
  return {
    step: issueSteps(
      { id: issue.id, status: issue.status, safetyCritical: issue.safetyCritical, planned: false },
      viewer,
      facts,
    ).primary,
    record: { kind: "issue", id: issue.id },
  };
}

// ---------------------------------------------------------------------------
// The status sentence

export type GroundedPhase =
  | "noWorkOrder"
  | "repairRefused"
  | "awaitingAuthorization"
  | "inProgress"
  | "completionSentBack"
  | "awaitingSignOff"
  /** Completed; the timeline shows no sign-off, or could not be read. */
  | "awaitingRelease"
  /** Completed through a sign-off (COMPLETION_SUBMITTED, then approved). */
  | "awaitingReleaseSignedOff"
  | "issueClosedAwaitingRelease"
  /**
   * The three above, while another safety-critical problem is OPEN: nobody can
   * release until it is closed (SAFETY_ISSUE_OPEN), so no manager is waited on.
   */
  | "otherIssueOpen"
  | "otherIssueOpenSignedOff"
  | "issueClosedOtherIssueOpen";

const BLOCKED_PHASE: Partial<Record<GroundedPhase, GroundedPhase>> = {
  awaitingRelease: "otherIssueOpen",
  awaitingReleaseSignedOff: "otherIssueOpenSignedOff",
  issueClosedAwaitingRelease: "issueClosedOtherIssueOpen",
};

export type Situation =
  | { kind: "disposed"; status: DisposedStatus }
  | { kind: "registered" }
  | { kind: "notAssessed" }
  | { kind: "available"; commissionedAt: string | null; lastTripAt: string | null }
  | {
      kind: "grounded";
      since: string;
      days: number;
      report: string;
      phase: GroundedPhase;
      /**
       * Every work order on the grounding problem is done and nothing else
       * stands in the release's way: the server's ASSET_AWAITING_RELEASE for
       * this grounding, which it withholds while another safety-critical
       * problem is OPEN (SAFETY_ISSUE_OPEN). Still grounded until released.
       */
      repaired: boolean;
      issueId: string;
      workOrderId: string | undefined;
      /** The first other open safety-critical problem, when it is what blocks the release. */
      blockedBy?: { id: string; description: string; count: number };
    };

const DAY_MS = 86_400_000;

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole calendar days on the reader's clock: grounded last night reads "since yesterday". */
export function daysSince(iso: string, now: Date): number {
  return Math.max(0, Math.round((startOfLocalDay(now) - startOfLocalDay(new Date(iso))) / DAY_MS));
}

/** The events that settle a work order's completion, and whether each is a sign-off. */
const COMPLETION_EVENTS: Record<string, boolean> = {
  "work_order.completed": false,
  "work_order.completion_approved": true,
  // Written before #28 renamed the states; audit events are kept forever.
  "work_order.closed": false,
  "work_order.closure_approved": true,
};

/**
 * Whether the standing completion was signed off, read off the work order's
 * timeline (oldest first): the last settling event decides. The availability
 * read cannot tell, so without the timeline the answer is no — the sentence
 * then says "completed", never a sign-off that may not have happened.
 */
export function completionSignedOff(chronologie: readonly { kind: string }[] | undefined): boolean {
  const settled = chronologie?.filter((event) => event.kind in COMPLETION_EVENTS).at(-1);
  return settled !== undefined && COMPLETION_EVENTS[settled.kind] === true;
}

function groundedPhase(
  facts: GroundingFacts,
  attention: readonly AssetAttentionItem[],
  signedOff: boolean,
): GroundedPhase {
  const wo = facts.workOrder;
  if (wo === undefined) {
    if (facts.grounded.issue.status !== "OPEN") return "issueClosedAwaitingRelease";
    return facts.refused === undefined ? "noWorkOrder" : "repairRefused";
  }
  switch (wo.status) {
    case "SUBMITTED":
      return "awaitingAuthorization";
    case "APPROVED": {
      const sentBack = attention.some(
        (item) =>
          item.code === "WORK_ORDER_IN_PROGRESS" &&
          item.subject.id === wo.id &&
          item.params.completionRejectReason !== undefined,
      );
      return sentBack ? "completionSentBack" : "inProgress";
    }
    case "COMPLETION_SUBMITTED":
      return "awaitingSignOff";
    default:
      return signedOff ? "awaitingReleaseSignedOff" : "awaitingRelease";
  }
}

/**
 * Which sentence the header says. Lifecycle first — a sold truck is not
 * "available" — then availability, which only the maintenance module can speak
 * to: without it the answer is "not assessed", never a silent "available".
 * `signedOff` is `completionSignedOff` of the grounding work order's timeline.
 */
export function situationOf(
  asset: Pick<AssetDetail, "availability" | "lifecycleStatus" | "commissionedAt" | "recentActivities">,
  attention: readonly AssetAttentionItem[],
  now: Date,
  signedOff = false,
): Situation {
  if ((DISPOSED as readonly string[]).includes(asset.lifecycleStatus)) {
    return { kind: "disposed", status: asset.lifecycleStatus as DisposedStatus };
  }
  const facts = groundingFacts(asset);
  if (facts !== undefined) {
    const ready = groundedPhase(facts, attention, signedOff);
    const others = facts.grounded.otherOpenSafetyIssues;
    const [first] = others;
    const blocked = first === undefined ? undefined : BLOCKED_PHASE[ready];
    const phase = blocked ?? ready;
    return {
      kind: "grounded",
      since: facts.grounded.since,
      days: daysSince(facts.grounded.since, now),
      report: facts.grounded.issue.description,
      phase,
      repaired:
        (phase === "awaitingRelease" || phase === "awaitingReleaseSignedOff") &&
        attention.some(
          (item) => item.code === "ASSET_AWAITING_RELEASE" && item.subject.id === facts.grounded.intervalId,
        ),
      issueId: facts.grounded.issue.id,
      workOrderId: (facts.workOrder ?? facts.refused)?.id,
      ...(blocked !== undefined &&
        first !== undefined && { blockedBy: { id: first.id, description: first.description, count: others.length } }),
    };
  }
  if (asset.lifecycleStatus === "REGISTERED") return { kind: "registered" };
  if (asset.availability.state === "NOT_ASSESSED") return { kind: "notAssessed" };
  const last = asset.recentActivities[0];
  return {
    kind: "available",
    commissionedAt: asset.commissionedAt,
    lastTripAt: last === undefined ? null : (last.endedAt ?? last.startedAt),
  };
}

// ---------------------------------------------------------------------------
// Attention: the to-do list

/** Who an item is waiting on, when it is not the viewer. */
export type WaitingOn =
  | "workshop"
  | "finance"
  | "financePeer"
  | "director"
  | "manager"
  | "operations"
  | "recorder"
  | "team";

export interface Todo {
  item: AssetAttentionItem;
  record: PanelRef | null;
  step: RoleStep;
  who: WaitingOn;
}

const WAITING_ON: Record<AssetAttentionItem["code"], WaitingOn> = {
  ISSUE_UNPLANNED: "workshop",
  ISSUE_OPEN_WHILE_AVAILABLE: "workshop",
  WORK_ORDER_AWAITING_AUTHORIZATION: "manager",
  WORK_ORDER_IN_PROGRESS: "workshop",
  WORK_ORDER_AWAITING_SIGN_OFF: "manager",
  WORK_ORDER_COST_TO_COME: "workshop",
  ASSET_AWAITING_RELEASE: "manager",
  DOCUMENT_EXPIRED: "operations",
  DOCUMENT_EXPIRING: "operations",
  ENTRY_AWAITING_REVIEW: "finance",
  ENTRY_EVIDENCE_MISSING: "recorder",
  // Direction's own note waits for anyone on the vehicle to say they saw it.
  DIRECTION_NOTE: "team",
};

/** A waiting entry waits on whoever the read says decides it (#542). */
function waitingOn(item: AssetAttentionItem): WaitingOn {
  if (item.code === "ENTRY_AWAITING_REVIEW") {
    if (item.params.approver === "DIRECTION_APPROVES") return "director";
    if (item.params.approver === "FINANCE_PEER_APPROVES") return "financePeer";
  }
  return WAITING_ON[item.code];
}

export function attentionRecord(
  item: AssetAttentionItem,
  asset: Pick<AssetDetail, "availability">,
): PanelRef | null {
  const { entityType, id } = item.subject;
  switch (entityType) {
    case "operational_issue":
      return { kind: "issue", id };
    case "work_order":
      return { kind: "work_order", id };
    case "document":
      return { kind: "document", id };
    case "financial_entry":
      return { kind: "entry", id };
    case "note":
      return { kind: "note", id };
    case "asset_availability_interval":
      return groundingRecord(asset);
  }
}

function groundingRecord(asset: Pick<AssetDetail, "availability">): PanelRef | null {
  const facts = groundingFacts(asset);
  if (facts === undefined) return null;
  return facts.workOrder !== undefined
    ? { kind: "work_order", id: facts.workOrder.id }
    : { kind: "issue", id: facts.grounded.issue.id };
}

/** The viewer's step on one attention item; the maker list is the server's word. */
export function attentionStep(
  item: AssetAttentionItem,
  viewer: Viewer,
  asset: Pick<AssetDetail, "availability">,
): RoleStep {
  const record = attentionRecord(item, asset) ?? undefined;
  const maker = item.makerPrincipalIds.includes(viewer.principalId);
  const go = (key: StepKey): RoleStep => ({ kind: "go", step: { key, record } });
  const locked = (key: StepKey, lock: Lock): RoleStep => ({
    kind: "locked",
    step: { key, record },
    lock,
  });
  const ref: NumberedRecord = { kind: "work_order", number: item.params.recordNumber ?? null };

  switch (item.code) {
    case "ISSUE_UNPLANNED":
      return may.manageWorkOrders(viewer) ? go("create-work-order") : { kind: "none" };
    case "ISSUE_OPEN_WHILE_AVAILABLE":
      // Released on a completed repair, but nobody closed the report.
      return may.resolveIssues(viewer) ? go("resolve-issue") : { kind: "none" };
    case "WORK_ORDER_AWAITING_AUTHORIZATION":
      if (!may.approveWorkOrders(viewer)) return { kind: "none" };
      return maker
        ? locked("approve-work-order", { key: "makerCannotApprove", ref })
        : go("approve-work-order");
    case "WORK_ORDER_IN_PROGRESS":
      return may.manageWorkOrders(viewer) ? go("complete-work-order") : { kind: "none" };
    case "WORK_ORDER_AWAITING_SIGN_OFF":
      if (!may.approveWorkOrders(viewer)) return { kind: "none" };
      return maker
        ? locked("approve-completion", { key: "completerCannotSignOff", ref })
        : go("approve-completion");
    case "WORK_ORDER_COST_TO_COME":
      return may.addCost(viewer) ? go("add-cost") : { kind: "none" };
    case "ASSET_AWAITING_RELEASE": {
      if (!may.release(viewer)) return { kind: "none" };
      if (viewer.principalType !== "HUMAN") return locked("release", { key: "humanOnly" });
      return maker ? locked("release", { key: "selfReleaseForbidden" }) : go("release");
    }
    case "DOCUMENT_EXPIRED":
    case "DOCUMENT_EXPIRING":
      return may.renewDocuments(viewer) ? go("renew-document") : { kind: "none" };
    case "ENTRY_AWAITING_REVIEW":
      if (!may.approveEntries(viewer)) return { kind: "none" };
      if (maker) return locked("review-entry", { key: "youRecordedIt" });
      return item.params.directionDecides === true
        ? locked("review-entry", { key: "directionDecides" })
        : go("review-entry");
    case "ENTRY_EVIDENCE_MISSING":
      return mayAttachTo(item.params.recordedBy, viewer) ? go("attach-evidence") : { kind: "none" };
    case "DIRECTION_NOTE":
      // Everyone who sees the vehicle may say they saw it, but not its author.
      return maker ? { kind: "none" } : go("acknowledge-note");
  }
}

/**
 * Everything that needs someone, except the grounding: the status sentence
 * owns that, so the list never repeats it. Most severe first, as served.
 */
export function buildTodos(
  items: readonly AssetAttentionItem[],
  asset: Pick<AssetDetail, "availability">,
  viewer: Viewer,
): Todo[] {
  return items
    .filter((item) => !item.partOfGrounding)
    .map((item) => ({
      item,
      record: attentionRecord(item, asset),
      step: attentionStep(item, viewer, asset),
      who: waitingOn(item),
    }));
}

/** The numbers the tab strip carries: the to-dos that are the viewer's, and a maintenance flag. */
export function tabMarkers(
  items: readonly AssetAttentionItem[],
  asset: Pick<AssetDetail, "availability">,
  viewer: Viewer,
): { todoCount: number; maintenanceNeedsYou: boolean } {
  const todoCount = buildTodos(items, asset, viewer).filter((t) => t.step.kind === "go").length;
  const maintenanceNeedsYou =
    groundingStep(asset, viewer).step.kind === "go" ||
    items.some(
      (item) =>
        (item.subject.entityType === "work_order" ||
          item.subject.entityType === "operational_issue") &&
        attentionStep(item, viewer, asset).kind === "go",
    );
  return { todoCount, maintenanceNeedsYou };
}
