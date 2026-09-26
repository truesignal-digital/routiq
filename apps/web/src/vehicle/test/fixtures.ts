import type {
  ActivityListItem,
  AssetDocumentRead,
  AssetFinanceResponse,
  FinancialEntryDetail,
  FinancialEntryListItem,
  IssueDetail,
  IssueListItem,
  VehicleHistoryItem,
  WorkOrderDetail,
  WorkOrderListItem,
  AssetAttentionItem,
  AssetAvailability,
  AssetDetail,
  AvailabilityWorkOrder,
  HistoryActor,
  ModuleCode,
  Role,
  WorkOrderStatus,
} from "@routiq/contracts";
import type { MeContext } from "../../auth/me.js";
import { viewerOf, type Viewer } from "../model.js";

export const ASSET_ID = "00000000-0000-4000-8000-00000000a001";
export const BRANCH_ID = "00000000-0000-4000-8000-00000000b001";
export const ISSUE_ID = "00000000-0000-4000-8000-00000000c001";
export const OTHER_ISSUE_ID = "00000000-0000-4000-8000-00000000c002";
export const WORK_ORDER_ID = "00000000-0000-4000-8000-00000000d001";
export const ENTRY_ID = "00000000-0000-4000-8000-00000000e001";
export const DOCUMENT_ID = "00000000-0000-4000-8000-00000000f001";
export const INTERVAL_ID = "00000000-0000-4000-8000-00000000a0a1";

/** The principal the tests sign in as; `other` made everything else. */
export const ME_ID = "00000000-0000-4000-8000-000000000002";
export const OTHER_ID = "00000000-0000-4000-8000-000000000099";

export const ALL_MODULES: ModuleCode[] = [
  "CORE",
  "ASSETS",
  "FINANCE",
  "DOCUMENTS",
  "ACTIVITIES",
  "MAINTENANCE",
];

export function actor(principalId: string | null, displayName: string | null = "Boris"): HistoryActor {
  return { principalId, displayName, scope: "WORKSPACE" };
}

export function me(role: Role, modules: ModuleCode[] = ALL_MODULES): MeContext {
  return {
    workspaceId: "00000000-0000-4000-8000-000000000001",
    principalId: ME_ID,
    principalType: "HUMAN",
    membershipId: "00000000-0000-4000-8000-000000000003",
    role,
    branchScope: "ALL",
    enabledModules: modules,
    enabledPresets: ["TRUCKING"],
  };
}

export function viewer(role: Role, modules: ModuleCode[] = ALL_MODULES): Viewer {
  return viewerOf(me(role, modules));
}

export function groundingWorkOrder(
  status: WorkOrderStatus,
  overrides: Partial<AvailabilityWorkOrder> = {},
): AvailabilityWorkOrder {
  return {
    id: WORK_ORDER_ID,
    status,
    rowVersion: 3,
    createdAt: "2026-09-22T18:05:00.000Z",
    createdBy: actor(OTHER_ID, "Boris"),
    completedBy:
      status === "COMPLETION_SUBMITTED" || status === "COMPLETED" ? actor(OTHER_ID, "Hervé") : null,
    ...overrides,
  };
}

export function grounded(
  workOrders: AvailabilityWorkOrder[] = [],
  issue: Partial<Extract<AssetAvailability, { state: "GROUNDED" }>["issue"]> = {},
): AssetAvailability {
  return {
    state: "GROUNDED",
    since: "2026-09-22T08:00:00.000Z",
    intervalId: INTERVAL_ID,
    intervalRowVersion: 1,
    issue: {
      id: ISSUE_ID,
      description: "Brake pressure warning on the Kekem descent",
      safetyCritical: true,
      category: "BRAKES",
      status: "OPEN",
      rowVersion: 1,
      reportedAt: "2026-09-22T08:00:00.000Z",
      reportedBy: actor(OTHER_ID, "Sali"),
      closedBy: null,
      ...issue,
    },
    workOrders,
  };
}

export function asset(overrides: Partial<AssetDetail> = {}): AssetDetail {
  return {
    id: ASSET_ID,
    assetCode: "VH003",
    registrationNumber: "LT 482 AB",
    manufacturer: "Mercedes-Benz",
    model: "Actros 2644",
    lifecycleStatus: "IN_SERVICE",
    rowVersion: 4,
    category: { code: "TRUCK", labelFr: "Camion", labelEn: "Truck" },
    branch: { code: "DLA", name: "Douala" },
    branchId: BRANCH_ID,
    assetClassCode: "TRUCK",
    templateCode: "TRUCKING",
    templateVersion: 1,
    chassisNumber: "WDB9634031L123456",
    modelYear: 2019,
    acquisitionDate: "2024-03-01",
    acquisitionAmountMinor: 45_000_000,
    currency: "XAF",
    commissionedAt: "2024-03-10T08:00:00.000Z",
    customValues: { axleCount: 3, bodyType: "Tautliner" },
    finance: {
      currency: "XAF",
      revenueMinor: 2_850_000,
      expenseMinor: 1_345_000,
      netMinor: 1_505_000,
      expenseByCategory: [],
    },
    recentActivities: [],
    custodian: {
      membershipId: "00000000-0000-4000-8000-000000000090",
      displayName: "Sali",
      active: true,
      since: "2026-08-01T08:00:00.000Z",
    },
    availability: { state: "AVAILABLE", since: null },
    lastReading: {
      id: "00000000-0000-4000-8000-0000000000aa",
      readingType: "ODOMETER",
      value: 186_112,
      observedAt: "2026-09-23T09:10:00.000Z",
      source: "WORK_ORDER",
      activityId: null,
      recordedBy: actor(OTHER_ID, "Hervé"),
    },
    ...overrides,
  };
}

export function attention(
  code: AssetAttentionItem["code"],
  overrides: Partial<AssetAttentionItem> = {},
): AssetAttentionItem {
  const subjects: Record<AssetAttentionItem["code"], AssetAttentionItem["subject"]> = {
    ISSUE_UNPLANNED: { entityType: "operational_issue", id: OTHER_ISSUE_ID, number: null, rowVersion: 1 },
    ISSUE_OPEN_WHILE_AVAILABLE: { entityType: "operational_issue", id: ISSUE_ID, number: null, rowVersion: 2 },
    WORK_ORDER_AWAITING_AUTHORIZATION: { entityType: "work_order", id: WORK_ORDER_ID, number: null, rowVersion: 1 },
    WORK_ORDER_IN_PROGRESS: { entityType: "work_order", id: WORK_ORDER_ID, number: null, rowVersion: 2 },
    WORK_ORDER_AWAITING_SIGN_OFF: { entityType: "work_order", id: WORK_ORDER_ID, number: null, rowVersion: 3 },
    ASSET_AWAITING_RELEASE: { entityType: "asset_availability_interval", id: INTERVAL_ID, number: null, rowVersion: 1 },
    DOCUMENT_EXPIRED: { entityType: "document", id: DOCUMENT_ID, number: "VT-DLA-23981", rowVersion: null },
    DOCUMENT_EXPIRING: { entityType: "document", id: DOCUMENT_ID, number: "POL-448210", rowVersion: null },
    ENTRY_AWAITING_REVIEW: { entityType: "financial_entry", id: ENTRY_ID, number: "DLA-2026-00006", rowVersion: 1 },
    ENTRY_EVIDENCE_MISSING: { entityType: "financial_entry", id: ENTRY_ID, number: "DLA-2026-00006", rowVersion: 1 },
  };
  return {
    code,
    severity: code === "DOCUMENT_EXPIRED" ? "CRITICAL" : code.startsWith("ENTRY_AWAITING") ? "INFO" : "WARNING",
    subject: subjects[code],
    since: "2026-09-23T00:00:00.000Z",
    partOfGrounding: false,
    makerPrincipalIds: [],
    params: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reads the workspace sections load


const assetRef = { id: ASSET_ID, assetCode: "VH003", registrationNumber: "LT 482 AB" };
const branchRef = { id: BRANCH_ID, code: "DLA", name: "Douala" };

export function workOrderRow(status: WorkOrderStatus, overrides: Partial<WorkOrderListItem> = {}): WorkOrderListItem {
  return {
    id: WORK_ORDER_ID,
    status,
    description: "Brake repair: replace pads and air valve",
    asset: assetRef,
    branch: branchRef,
    expectedCostMinor: 450_000,
    actualCostMinor: null,
    currency: "XAF",
    issue: { id: ISSUE_ID, safetyCritical: true },
    createdAt: "2026-09-22T18:05:00.000Z",
    completedAt: null,
    cancelledAt: null,
    rejectedAt: null,
    rowVersion: 3,
    createdBy: actor(OTHER_ID, "Boris"),
    completedBy: status === "COMPLETION_SUBMITTED" || status === "COMPLETED" ? actor(OTHER_ID, "Hervé") : null,
    ...overrides,
  };
}

export function workOrderDetail(status: WorkOrderStatus, overrides: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    ...workOrderRow(status),
    summary: null,
    cancelReason: null,
    rejectReason: null,
    completionRejectReason: null,
    resolveLinkedIssue: false,
    createdByCommandId: "00000000-0000-4000-8000-0000000000c1",
    chronologie: [
      {
        eventId: "00000000-0000-4000-8000-0000000000c2",
        kind: "work_order.created",
        occurredAt: "2026-09-22T18:05:00.000Z",
        actor: actor(OTHER_ID, "Boris"),
      },
    ],
    costLines: [],
    pendingCostLines: [],
    ...overrides,
  };
}

export function issueRow(overrides: Partial<IssueListItem> = {}): IssueListItem {
  return {
    id: ISSUE_ID,
    asset: assetRef,
    branch: branchRef,
    description: "Brake pressure warning on the Kekem descent",
    safetyCritical: true,
    category: "BRAKES",
    reportedAt: "2026-09-22T08:00:00.000Z",
    status: "OPEN",
    resolvedAt: null,
    resolutionNote: null,
    dismissedAt: null,
    dismissReason: null,
    workOrders: [],
    assetUnavailable: true,
    rowVersion: 1,
    ...overrides,
  };
}

export function issueDetail(overrides: Partial<IssueDetail> = {}): IssueDetail {
  return {
    ...issueRow(),
    chronologie: [
      {
        eventId: "00000000-0000-4000-8000-0000000000c3",
        kind: "operational_issue.reported",
        occurredAt: "2026-09-22T08:00:00.000Z",
        actor: actor(OTHER_ID, "Sali"),
      },
    ],
    artifactCount: 2,
    closedBy: null,
    ...overrides,
  };
}

export function entryRow(overrides: Partial<FinancialEntryListItem> = {}): FinancialEntryListItem {
  return {
    id: ENTRY_ID,
    entryNumber: "DLA-2026-00006",
    direction: "EXPENSE",
    status: "SUBMITTED",
    category: { code: "REPAIRS", labelFr: "Réparations", labelEn: "Repairs", layer: "MAINTENANCE" },
    amountMinor: 310_000,
    currency: "XAF",
    economicDate: "2026-09-23",
    postingPeriodCode: null,
    isLatePosting: false,
    branchId: BRANCH_ID,
    counterpartyName: "Garage Tchinda",
    paymentMethod: "CASH",
    estimateStatus: "ACTUAL",
    postedAt: null,
    rowVersion: 1,
    reversesEntryId: null,
    recordedBy: actor(OTHER_ID, "Hervé"),
    evidence: { state: "NOT_SUPPLIED", artifactCount: 0 },
    assetShareMinor: 310_000,
    assetLinks: { activityId: null, activityNumber: null, workOrderId: WORK_ORDER_ID },
    ...overrides,
  };
}

export function entryDetail(overrides: Partial<FinancialEntryDetail> = {}): FinancialEntryDetail {
  return {
    ...entryRow(),
    assetShareMinor: null,
    assetLinks: null,
    description: null,
    paymentReference: null,
    sourceReference: null,
    rejectedReason: null,
    reversedByEntryId: null,
    postings: [
      {
        lineNo: 1,
        amountMinor: 310_000,
        assetId: ASSET_ID,
        assetCode: "VH003",
        assetAttribution: "DIRECT",
        category: { code: "REPAIRS", labelFr: "Réparations", labelEn: "Repairs" },
      },
    ],
    evidenceFiles: [],
    ...overrides,
  };
}

export const TRIP_ID = "00000000-0000-4000-8000-0000000000b7";

export function tripRow(overrides: Partial<ActivityListItem> = {}): ActivityListItem {
  return {
    id: TRIP_ID,
    activityNumber: "DLA-2026-00003",
    activityType: { code: "HAULAGE_JOB", labelFr: "Transport", labelEn: "Haulage job" },
    status: "OPEN",
    completeness: null,
    completenessCodes: [],
    startedAt: "2026-07-29T06:00:00.000Z",
    endedAt: null,
    customerName: "Client Yaoundé",
    clientReference: null,
    branchId: BRANCH_ID,
    primaryAssetCode: "VH003",
    legCount: 1,
    crewCount: 1,
    originName: "Douala",
    destinationName: "Yaoundé",
    distanceKm: 245,
    driverName: "Jean Ngwa",
    ...overrides,
  };
}

export function documentRow(overrides: Partial<AssetDocumentRead> = {}): AssetDocumentRead {
  return {
    id: DOCUMENT_ID,
    type: { code: "INSPECTION", labelFr: "Visite technique", labelEn: "Technical inspection" },
    title: null,
    documentNumber: "VT-DLA-23981",
    issuedAt: "2025-09-23",
    expiresAt: "2026-09-23",
    supersedesDocumentId: null,
    supersededByDocumentId: null,
    createdAt: "2025-09-23T08:00:00.000Z",
    artifactCount: 0,
    ...overrides,
  };
}

export function finance(periodCode = "2026-09", overrides: Partial<AssetFinanceResponse> = {}): AssetFinanceResponse {
  return {
    assetId: ASSET_ID,
    currency: "XAF",
    periodCode,
    periodStatus: "OPEN",
    layers: ["DIRECT", "MAINTENANCE", "OWNERSHIP", "SHARED"],
    posted: { basis: "POSTING_PERIOD", expenseMinor: 661_000, revenueMinor: 0, entryCount: 3 },
    pending: { basis: "ECONOMIC_MONTH", expenseMinor: 310_000, entryCount: 1 },
    rejected: { basis: "ECONOMIC_MONTH", entryCount: 0 },
    evidenceMissing: { postedCount: 1, pendingCount: 0 },
    byCategory: [
      { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel", layer: "DIRECT", expenseMinor: 421_000 },
      { code: "TOLLS", labelFr: "Péages", labelEn: "Tolls", layer: "DIRECT", expenseMinor: 240_000 },
    ],
    series: ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", periodCode].map((code) => ({
      periodCode: code,
      expenseMinor: 100_000,
      revenueMinor: 50_000,
    })),
    ...overrides,
  };
}

export function historyItem(overrides: Partial<VehicleHistoryItem> = {}): VehicleHistoryItem {
  return {
    eventId: "00000000-0000-4000-8000-0000000000d9",
    eventType: "operational_issue.reported",
    kind: "MAINTENANCE",
    occurredAt: "2026-09-22T08:00:00.000Z",
    actor: actor(OTHER_ID, "Sali"),
    origin: "HUMAN_UI",
    subject: { entityType: "operational_issue", id: ISSUE_ID, number: null },
    amountMinor: null,
    currency: null,
    params: { description: "Brake pressure warning on the Kekem descent", safetyCritical: true },
    note: null,
    ...overrides,
  };
}
