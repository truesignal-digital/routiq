import { z } from "zod";
import { COMMAND_ORIGINS } from "../envelope.js";
import type { ModuleCode } from "../modules.js";
import { listQuery, listResponse } from "./list.js";

/**
 * Entity types the audit trail addresses. Closed on purpose — unlike
 * `eventType`, this is our own row vocabulary, and a URL segment has to resolve
 * to an owning module before the read can decide who may see the timeline.
 */
export const HISTORY_ENTITY_TYPES = [
  "activity",
  "activity_asset_segment",
  "approval_rule",
  "asset",
  "asset_availability_interval",
  "category",
  "document",
  "financial_entry",
  "meter_reading",
  "movement_leg",
  "note",
  "operational_issue",
  "person",
  "posting_period",
  "work_order",
  "workspace",
  "workspace_module",
  "workspace_template",
] as const;

export const historyEntityType = z.enum(HISTORY_ENTITY_TYPES);

export type HistoryEntityType = (typeof HISTORY_ENTITY_TYPES)[number];

/**
 * History is visible to whoever can read the record, so the owning module's
 * entitlement and tenant RLS apply, and every type that has a branch — its own
 * or its parent's — is read against the actor's branch scope. Ownership mirrors
 * the `module`
 * field on the commands that write each entity type — `person` sits under
 * ACTIVITIES because `register-person` does.
 */
export const HISTORY_ENTITY_MODULE = {
  activity: "ACTIVITIES",
  activity_asset_segment: "ACTIVITIES",
  approval_rule: "CORE",
  asset: "ASSETS",
  /**
   * MAINTENANCE, not ASSETS: the grounding is opened by `report-issue` and
   * closed by `release-asset-to-service`, so it follows the module whose
   * commands write it — same rule that puts `person` under ACTIVITIES.
   */
  asset_availability_interval: "MAINTENANCE",
  category: "CORE",
  document: "DOCUMENTS",
  financial_entry: "FINANCE",
  meter_reading: "ACTIVITIES",
  movement_leg: "ACTIVITIES",
  /** `add-note` is a CORE command: every member may annotate what they can see. */
  note: "CORE",
  operational_issue: "MAINTENANCE",
  person: "ACTIVITIES",
  posting_period: "FINANCE",
  work_order: "MAINTENANCE",
  workspace: "CORE",
  workspace_module: "CORE",
  workspace_template: "CORE",
} as const satisfies Record<HistoryEntityType, ModuleCode>;

/**
 * No filters and no `sort`: a timeline has one meaningful order, so newest-first
 * is fixed server-side and only the keyset controls travel.
 */
export const historyListQuery = listQuery({});

export const historyActorScopes = ["WORKSPACE", "PLATFORM"] as const;
export const historyActorScope = z.enum(historyActorScopes);

/**
 * `principalId` and `displayName` are null exactly for PLATFORM events: the
 * generated `tenant_actor_principal_id` masks the actor for them, so the
 * principals join yields nothing and the label derives from `scope` alone
 * ("by ROUTIQ").
 */
export const historyActor = z.object({
  principalId: z.uuid().nullable(),
  displayName: z.string().nullable(),
  scope: historyActorScope,
});

export const historyCommandRef = z.object({
  id: z.uuid(),
  name: z.string(),
  version: z.string(),
  origin: z.enum(COMMAND_ORIGINS),
  clientOccurredAt: z.iso.datetime().nullable(),
});

export const historyItem = z.object({
  eventId: z.uuid(),
  /** Open set — the read never enumerates event types; unknown codes render raw. */
  eventType: z.string(),
  occurredAt: z.iso.datetime(),
  actor: historyActor,
  command: historyCommandRef,
  changedFields: z.array(z.string()),
  /**
   * Reopen motifs and correction reasons, lifted server-side from an allowlist
   * of state keys; null when the event carries none. `before_state` and
   * `after_state` themselves stay out of the list — it has to stay light on 2G.
   */
  note: z.string().nullable(),
});

export const historyListResponse = listResponse(historyItem);

/**
 * The state keys a single event may surface, per entity type — an allowlist, not
 * a filter. `before_state`/`after_state` are row snapshots written by whatever
 * command touched the row, so a passthrough would ship whatever a future command
 * decides to snapshot; user-management events will put principal state in there,
 * and a PIN hash must never reach a client. A key missing here is invisible, so
 * auditing a new field is deliberately two steps: write it, then allow it.
 *
 * Populated from what the `appendAuditEvent` call sites in
 * `apps/api/src/commands/` actually write today. Bookkeeping columns (`id`,
 * `workspaceId`, `rowVersion`, `*ByCommandId`) are left out on purpose: they are
 * in every snapshot, they say nothing to an operator, and omitting them keeps
 * the payload small on 2G. The diff renders in the order listed here.
 */
export const HISTORY_STATE_KEYS = {
  activity: [
    "status",
    "completeness",
    "completenessCodes",
    "activityNumber",
    "activityTypeCode",
    "activityTypeId",
    "branchId",
    "startedAt",
    "endedAt",
    "plannedEndAt",
    "customerName",
    "clientReference",
    "description",
    "note",
    "reason",
    "customValues",
    "crew",
    "segments",
    "segmentIds",
    "legIds",
    "readingIds",
    "entries",
    "role",
    "outgoingSegmentId",
    "outgoingAssetId",
    "outgoingEndedAt",
    "outgoingReadingId",
    "incomingReadingId",
    "newSegmentId",
    "substituteAssetId",
    "templateCode",
    "templateVersion",
  ],
  /**
   * Empty on purpose: no command writes an audit event against a segment today —
   * substitution is audited on the activity. Populate it the day one does.
   */
  activity_asset_segment: [],
  approval_rule: ["commandType", "amountMaxMinor"],
  asset: [
    "assetCode",
    "assetClassCode",
    "lifecycleStatus",
    "registrationNumber",
    "chassisNumber",
    "manufacturer",
    "model",
    "modelYear",
    "branchId",
    "custodianMembershipId",
    "commissionedAt",
    "acquisitionDate",
    "acquisitionAmountMinor",
    "currency",
    "customValues",
    "templateCode",
    "templateVersion",
  ],
  /**
   * A grounding, from `asset_availability.opened` and `.closed`. `closedAt`
   * moving from null to a timestamp IS the release — availability is not
   * lifecycle status, so nothing else on the row says the truck came back.
   * `closedByCommandId` is bookkeeping and stays out; `releaseNote` is the
   * releaser's own words and does not.
   */
  asset_availability_interval: [
    "assetId",
    "openedAt",
    "openedByIssueId",
    "closedAt",
    "releaseNote",
    "overrideReason",
  ],
  category: [
    "kind",
    "code",
    "labelFr",
    "labelEn",
    "profitabilityLayer",
    "evidencePolicy",
    "defaultSafetyCritical",
    "active",
  ],
  document: [
    "documentTypeCode",
    "documentNumber",
    "title",
    "assetId",
    "issuedAt",
    "expiresAt",
    "supersedesDocumentId",
  ],
  financial_entry: [
    "status",
    "entryNumber",
    "direction",
    "categoryId",
    "branchId",
    "amountMinor",
    "currency",
    "economicDate",
    "counterpartyName",
    "description",
    "paymentMethod",
    "paymentReference",
    "sourceReference",
    "estimateStatus",
    "postingPeriodId",
    "isLatePosting",
    "postedAt",
    "createdAt",
    "postings",
    "approvalNote",
    "rejectedReason",
    "reason",
    "reversesEntryId",
    "reversedByEntryId",
  ],
  meter_reading: [
    "readingType",
    "value",
    "observedAt",
    "source",
    "assetId",
    "activityId",
    "supersedesReadingId",
    "supersedeReason",
  ],
  movement_leg: [
    "legNo",
    "segmentId",
    "activityId",
    "originText",
    "originPlaceId",
    "destinationText",
    "destinationPlaceId",
    "departedAt",
    "arrivedAt",
    "distanceKm",
    "loadState",
    "passengerCount",
    "customValues",
  ],
  /** A note is its body and what it annotates; it never changes after `note.added`. */
  note: ["entityType", "entityId", "body"],
  /**
   * A signalement's report is never edited; what moves is its status, once —
   * resolved (on the spot or by a completed work order) or dismissed. The
   * timeline is what an operator opens to ask who called the truck unsafe, and
   * who said it was dealt with.
   */
  operational_issue: [
    "status",
    "assetId",
    "description",
    "safetyCritical",
    "category",
    "reportedAt",
    "resolvedAt",
    "resolutionNote",
    "resolvedByWorkOrderId",
    "dismissedAt",
    "dismissReason",
  ],
  person: [
    "displayName",
    "personCode",
    "phone",
    "defaultRole",
    "branchId",
    "membershipId",
    "active",
  ],
  posting_period: ["status", "lockedAt", "reason"],
  /**
   * The work-order workflow, from creation through both approvals to
   * completion, rejection, cancellation or release. `approvalNote` is the
   * authorizer's justification of a spend, the reject and cancel reasons the
   * refusal and abandonment motifs — all of them are why the decision was taken
   * and exist nowhere but the trail.
   */
  work_order: [
    "status",
    "description",
    "assetId",
    "issueId",
    "expectedCostMinor",
    "actualCostMinor",
    "currency",
    "summary",
    "resolveLinkedIssue",
    "completedAt",
    "rejectReason",
    "rejectedAt",
    "completionRejectReason",
    "cancelReason",
    "cancelledAt",
    "approvalNote",
    "availabilityIntervalId",
    "releasedAt",
    "releaseNote",
    "overrideReason",
  ],
  /**
   * `admin` and `users` from `workspace.provisioned` are deliberately absent:
   * they are principal snapshots carrying login usernames, and CORE entitles
   * every member to this timeline.
   */
  workspace: [
    "slug",
    "name",
    "defaultCurrency",
    "defaultLocale",
    "timezone",
    "branch",
    "enabledPresets",
    "disabledModules",
    "packs",
  ],
  workspace_module: ["moduleCode", "enabled", "updatedAt"],
  workspace_template: ["presetCode", "enabled"],
} as const satisfies Record<HistoryEntityType, readonly string[]>;

/**
 * Allowlisted keys whose value is money in minor units. XAF has exponent 0, so
 * the number is the amount — the client formats it, never divides it.
 */
export const HISTORY_MONEY_STATE_KEYS = [
  "amountMinor",
  "amountMaxMinor",
  "acquisitionAmountMinor",
  "expectedCostMinor",
  "actualCostMinor",
] as const;

export const historyValueKinds = ["MONEY", "VALUE"] as const;
export const historyValueKind = z.enum(historyValueKinds);

export const historyFieldChange = z.object({
  field: z.string(),
  /** MONEY pairs the value with the diff's `currency`; VALUE renders as it came. */
  kind: historyValueKind,
  before: z.json(),
  after: z.json(),
});

/**
 * What a single event changed — the only shape `before_state`/`after_state` are
 * ever served through. The list item already carries who, when and through which
 * command, so the diff repeats none of it: on 2G the expansion pays for the
 * changes alone.
 */
export const historyEventDiff = z.object({
  eventId: z.uuid(),
  /** For MONEY changes: the state's own currency, else the workspace default. */
  currency: z.string().length(3),
  changes: z.array(historyFieldChange),
});

export type HistoryListQuery = z.infer<typeof historyListQuery>;
export type HistoryActor = z.infer<typeof historyActor>;
export type HistoryItem = z.infer<typeof historyItem>;
export type HistoryListResponse = z.infer<typeof historyListResponse>;
export type HistoryValueKind = z.infer<typeof historyValueKind>;
export type HistoryFieldChange = z.infer<typeof historyFieldChange>;
export type HistoryEventDiff = z.infer<typeof historyEventDiff>;
