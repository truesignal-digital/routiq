import { z } from "zod";
import { CATEGORY_KINDS, EVIDENCE_POLICIES, PROFITABILITY_LAYERS } from "../commands/categories.js";
import { WORK_ORDER_COST_OUTCOMES } from "../commands/complete-work-order.js";
import { APPROVAL_THRESHOLD_COMMAND_TYPES } from "../commands/update-approval-threshold.js";
import { moneyMinor } from "../envelope.js";
import { ACTIVITY_COMPLETENESS_CODES } from "../errors.js";
import { MODULE_CODES } from "../modules.js";
import { TEMPLATE_CODES } from "../templates.js";
import {
  activityCompletenessValues,
  activityLegRead,
  activitySegmentRead,
  activityStatuses,
  personListItem,
} from "./activities.js";
import { assetLifecycleStatuses, METER_READING_SOURCES, METER_READING_TYPES } from "./assets.js";
import { financialEntryListItem, periodRead } from "./finance.js";
import { HISTORY_STATE_KEYS, type HistoryEntityType } from "./history.js";
import { issueStatuses, workOrderStatuses } from "./maintenance.js";

/**
 * Every closed code set a history diff can name. The diff sends the code and
 * the set it belongs to; the client owns the words, so each set maps to the
 * labels the rest of the app already shows for it (the status badges, the
 * forms). Built from the read contracts' own enums, so a code added there is a
 * code the diff — and the label test in the web app — knows about.
 */
export const HISTORY_CODE_SETS = {
  activityStatus: activityStatuses,
  activityCompleteness: activityCompletenessValues,
  completenessCode: ACTIVITY_COMPLETENESS_CODES,
  segmentRole: activitySegmentRead.shape.role.options,
  loadState: activityLegRead.shape.loadState.unwrap().options,
  personRole: personListItem.shape.defaultRole.unwrap().options,
  entryStatus: financialEntryListItem.shape.status.options,
  entryDirection: financialEntryListItem.shape.direction.options,
  paymentMethod: financialEntryListItem.shape.paymentMethod.options,
  estimateStatus: financialEntryListItem.shape.estimateStatus.options,
  periodStatus: periodRead.shape.status.options,
  workOrderStatus: workOrderStatuses,
  costOutcome: WORK_ORDER_COST_OUTCOMES,
  issueStatus: issueStatuses,
  lifecycleStatus: assetLifecycleStatuses,
  readingType: METER_READING_TYPES,
  readingSource: METER_READING_SOURCES,
  template: TEMPLATE_CODES,
  module: MODULE_CODES,
  categoryKind: CATEGORY_KINDS,
  profitabilityLayer: PROFITABILITY_LAYERS,
  evidencePolicy: EVIDENCE_POLICIES,
  approvalCommand: APPROVAL_THRESHOLD_COMMAND_TYPES,
} as const satisfies Record<string, readonly string[]>;

export type HistoryCodeSet = keyof typeof HISTORY_CODE_SETS;
export const historyCodeSet = z.enum(
  Object.keys(HISTORY_CODE_SETS) as [HistoryCodeSet, ...HistoryCodeSet[]],
);

/**
 * Records an id (or a category code) in a snapshot can point at. The read
 * resolves each to the name the app shows for that record, inside the caller's
 * workspace; an id that resolves to nothing is dropped, never shown.
 */
export const HISTORY_NAME_SOURCES = [
  "branch",
  "category",
  "assetClass",
  "documentType",
  "issueType",
  "member",
  "asset",
  "activity",
  "entry",
  "workOrder",
  "issue",
  "document",
  "period",
] as const;
export type HistoryNameSource = (typeof HISTORY_NAME_SOURCES)[number];

/**
 * How one allowlisted key reaches the record history sheet.
 *
 * - `VALUE`: free text, a number, a yes/no or an ISO date, shown as recorded.
 * - `MONEY`: minor units, formatted against the diff's currency; hidden with
 *   the rest of the money for roles that may not read it.
 * - `{ code }` / `{ codes }`: one code, or a list of codes, from a closed set.
 * - `{ name }`: an id resolved server-side to the record's name.
 * - `CREW`: the crew list, by the people's names.
 * - `SEGMENT_ASSETS`: the job's vehicles, by their names.
 * - `INLINE_NAME`: an object snapshot that carries its own `name`.
 * - `COUNT`: a list of ids, counted.
 * - `LINES`: posting lines, counted and totalled (the total is money).
 * - `HIDDEN`: allowlisted for another reader that labels it itself (the
 *   vehicle History tab lists specification changes key by key) and never
 *   shown in the sheet.
 *
 * Anything that cannot be shown one of these ways is left off the allowlist:
 * raw ids, codes and JSON never reach the screen (apps/web/AGENTS.md).
 */
export type HistoryFieldShape =
  | "VALUE"
  | "MONEY"
  | "CREW"
  | "SEGMENT_ASSETS"
  | "INLINE_NAME"
  | "COUNT"
  | "LINES"
  | "HIDDEN"
  | { code: HistoryCodeSet }
  | { codes: HistoryCodeSet }
  | { name: HistoryNameSource };

type FieldShapes = {
  [E in HistoryEntityType]: Record<(typeof HISTORY_STATE_KEYS)[E][number], HistoryFieldShape>;
};

/**
 * One shape per allowlisted key, per entity type. The type makes this
 * exhaustive: allowing a new key without deciding how it is shown does not
 * compile.
 */
export const HISTORY_FIELD_SHAPES: FieldShapes = {
  activity: {
    status: { code: "activityStatus" },
    completeness: { code: "activityCompleteness" },
    completenessCodes: { codes: "completenessCode" },
    activityNumber: "VALUE",
    activityTypeId: { name: "category" },
    branchId: { name: "branch" },
    startedAt: "VALUE",
    endedAt: "VALUE",
    plannedEndAt: "VALUE",
    customerName: "VALUE",
    clientReference: "VALUE",
    description: "VALUE",
    note: "VALUE",
    reason: "VALUE",
    crew: "CREW",
    segments: "SEGMENT_ASSETS",
    segmentIds: "COUNT",
    legIds: "COUNT",
    readingIds: "COUNT",
    role: { code: "segmentRole" },
    outgoingAssetId: { name: "asset" },
    outgoingEndedAt: "VALUE",
    substituteAssetId: { name: "asset" },
    templateCode: { code: "template" },
    templateVersion: "VALUE",
  },
  activity_asset_segment: {},
  approval_rule: {
    commandType: { code: "approvalCommand" },
    amountMaxMinor: "MONEY",
  },
  asset: {
    assetCode: "VALUE",
    assetClassCode: { name: "assetClass" },
    lifecycleStatus: { code: "lifecycleStatus" },
    registrationNumber: "VALUE",
    chassisNumber: "VALUE",
    manufacturer: "VALUE",
    model: "VALUE",
    modelYear: "VALUE",
    branchId: { name: "branch" },
    custodianMembershipId: { name: "member" },
    commissionedAt: "VALUE",
    acquisitionDate: "VALUE",
    acquisitionAmountMinor: "MONEY",
    currency: "VALUE",
    customValues: "HIDDEN",
    templateCode: { code: "template" },
    templateVersion: "VALUE",
  },
  asset_availability_interval: {
    assetId: { name: "asset" },
    openedAt: "VALUE",
    openedByIssueId: { name: "issue" },
    closedAt: "VALUE",
    releaseNote: "VALUE",
    overrideReason: "VALUE",
  },
  category: {
    kind: { code: "categoryKind" },
    code: "VALUE",
    labelFr: "VALUE",
    labelEn: "VALUE",
    profitabilityLayer: { code: "profitabilityLayer" },
    evidencePolicy: { code: "evidencePolicy" },
    defaultSafetyCritical: "VALUE",
    active: "VALUE",
  },
  document: {
    documentTypeCode: { name: "documentType" },
    documentNumber: "VALUE",
    title: "VALUE",
    assetId: { name: "asset" },
    issuedAt: "VALUE",
    expiresAt: "VALUE",
    supersedesDocumentId: { name: "document" },
  },
  financial_entry: {
    status: { code: "entryStatus" },
    entryNumber: "VALUE",
    direction: { code: "entryDirection" },
    categoryId: { name: "category" },
    branchId: { name: "branch" },
    amountMinor: "MONEY",
    currency: "VALUE",
    economicDate: "VALUE",
    counterpartyName: "VALUE",
    description: "VALUE",
    paymentMethod: { code: "paymentMethod" },
    paymentReference: "VALUE",
    sourceReference: "VALUE",
    estimateStatus: { code: "estimateStatus" },
    postingPeriodId: { name: "period" },
    isLatePosting: "VALUE",
    postedAt: "VALUE",
    createdAt: "VALUE",
    postings: "LINES",
    approvalNote: "VALUE",
    rejectedReason: "VALUE",
    reason: "VALUE",
    reversesEntryId: { name: "entry" },
    reversedByEntryId: { name: "entry" },
    artifactIds: "COUNT",
  },
  meter_reading: {
    readingType: { code: "readingType" },
    value: "VALUE",
    observedAt: "VALUE",
    source: { code: "readingSource" },
    assetId: { name: "asset" },
    activityId: { name: "activity" },
    supersedeReason: "VALUE",
  },
  movement_leg: {
    legNo: "VALUE",
    activityId: { name: "activity" },
    originText: "VALUE",
    destinationText: "VALUE",
    departedAt: "VALUE",
    arrivedAt: "VALUE",
    distanceKm: "VALUE",
    loadState: { code: "loadState" },
    passengerCount: "VALUE",
  },
  note: {
    body: "VALUE",
  },
  operational_issue: {
    status: { code: "issueStatus" },
    assetId: { name: "asset" },
    description: "VALUE",
    safetyCritical: "VALUE",
    category: { name: "issueType" },
    reportedAt: "VALUE",
    resolvedAt: "VALUE",
    resolutionNote: "VALUE",
    resolvedByWorkOrderId: { name: "workOrder" },
    dismissedAt: "VALUE",
    dismissReason: "VALUE",
  },
  person: {
    displayName: "VALUE",
    personCode: "VALUE",
    phone: "VALUE",
    defaultRole: { code: "personRole" },
    branchId: { name: "branch" },
    membershipId: { name: "member" },
    active: "VALUE",
  },
  posting_period: {
    status: { code: "periodStatus" },
    lockedAt: "VALUE",
    reason: "VALUE",
  },
  work_order: {
    status: { code: "workOrderStatus" },
    description: "VALUE",
    assetId: { name: "asset" },
    issueId: { name: "issue" },
    expectedCostMinor: "MONEY",
    actualCostMinor: "MONEY",
    declaredCostMinor: "MONEY",
    costOutcome: { code: "costOutcome" },
    currency: "VALUE",
    summary: "VALUE",
    resolveLinkedIssue: "VALUE",
    completedAt: "VALUE",
    rejectReason: "VALUE",
    rejectedAt: "VALUE",
    completionRejectReason: "VALUE",
    cancelReason: "VALUE",
    cancelledAt: "VALUE",
    approvalNote: "VALUE",
    releasedAt: "VALUE",
    releaseNote: "VALUE",
    overrideReason: "VALUE",
  },
  workspace: {
    slug: "VALUE",
    name: "VALUE",
    defaultCurrency: "VALUE",
    defaultLocale: "VALUE",
    timezone: "VALUE",
    branch: "INLINE_NAME",
    enabledPresets: { codes: "template" },
    disabledModules: { codes: "module" },
  },
  workspace_module: {
    moduleCode: { code: "module" },
    enabled: "VALUE",
    updatedAt: "VALUE",
  },
  workspace_template: {
    presetCode: { code: "template" },
    enabled: "VALUE",
  },
};

/** What a field shows as recorded: never an object, never a list. */
export const historyScalar = z.union([z.string(), z.number(), z.boolean()]).nullable();

/**
 * A resolved name in both app languages. Plain names (a branch, a vehicle, an
 * entry number) carry the same text twice; a category carries its two labels.
 */
export const historyName = z.object({ fr: z.string(), en: z.string() });

/** Posting lines, summarised. `totalMinor` is null when the reader may not see money. */
export const historyLines = z.object({
  count: z.number().int().nonnegative(),
  totalMinor: moneyMinor.nullable(),
});

const pair = <T extends z.ZodType>(value: T) => ({ before: value.nullable(), after: value.nullable() });

/**
 * One changed field, ready to display. The kind tells the client how to word
 * it; nothing here is a raw id, an unlabelled code or a JSON blob.
 */
export const historyDiffChange = z.discriminatedUnion("kind", [
  z.object({ field: z.string(), kind: z.literal("VALUE"), before: historyScalar, after: historyScalar }),
  z.object({ field: z.string(), kind: z.literal("MONEY"), ...pair(moneyMinor) }),
  z.object({ field: z.string(), kind: z.literal("CODE"), codeSet: historyCodeSet, ...pair(z.string()) }),
  z.object({ field: z.string(), kind: z.literal("CODES"), codeSet: historyCodeSet, ...pair(z.array(z.string())) }),
  z.object({ field: z.string(), kind: z.literal("NAME"), ...pair(historyName) }),
  z.object({ field: z.string(), kind: z.literal("NAMES"), ...pair(z.array(historyName)) }),
  z.object({ field: z.string(), kind: z.literal("COUNT"), ...pair(z.number().int().nonnegative()) }),
  z.object({ field: z.string(), kind: z.literal("LINES"), ...pair(historyLines) }),
]);

/**
 * What a single event changed — the only shape `before_state`/`after_state` are
 * ever served through. The list item already carries who, when and through which
 * command, so the diff repeats none of it: on 2G the expansion pays for the
 * changes alone.
 */
export const historyEventDiff = z.object({
  eventId: z.uuid(),
  /** For MONEY and LINES totals: the state's own currency, else the workspace default. */
  currency: z.string().length(3),
  changes: z.array(historyDiffChange),
});

export type HistoryName = z.infer<typeof historyName>;
export type HistoryLines = z.infer<typeof historyLines>;
export type HistoryDiffChange = z.infer<typeof historyDiffChange>;
export type HistoryEventDiff = z.infer<typeof historyEventDiff>;
