// PROTOTYPE — throwaway, issue #44. Sample vehicle workspace data.
// Real fields come from the asset detail read (identity, branch, lifecycle,
// lifetime money, recent trips). Everything else is sample data shaped after
// the develop contracts and the unmerged maintenance branch (cb6049a).

import type { AssetDetail, AssetLifecycleStatus } from "@routiq/contracts";

export type ProtoRole =
  | "ADMIN"
  | "OPS_MANAGER"
  | "MAINTENANCE"
  | "FIELD_SUBMITTER"
  | "FINANCE_APPROVER"
  | "EXECUTIVE_VIEWER";

export const ROLE_LABELS: Record<ProtoRole, string> = {
  ADMIN: "Administrator",
  OPS_MANAGER: "Operations manager",
  MAINTENANCE: "Technician",
  FIELD_SUBMITTER: "Driver / field",
  FINANCE_APPROVER: "Finance approver",
  EXECUTIVE_VIEWER: "Executive (read-only)",
};

export const TODAY = "2026-09-25";

export interface VehicleIdentity {
  id: string;
  code: string;
  displayName: string;
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  chassis: string | null;
  classLabel: string;
  templateCode: "TRUCKING" | "PASSENGER_TRANSPORT";
  homeBranch: { code: string; name: string };
  lifecycle: AssetLifecycleStatus;
  commissionedAt: string | null;
  acquisition: { date: string | null; amountMinor: number | null };
  capacity: string | null;
  specs: Array<{ label: string; value: string }>;
}

/** Availability is not lifecycle: a commissioned truck can still be grounded. */
export type Readiness =
  | { state: "AVAILABLE"; since: string }
  | { state: "GROUNDED"; since: string; reason: string; issueRef: string; workOrderRef: string | null; reportedBy: string }
  | { state: "NOT_ASSESSED" };

export interface Custodian {
  name: string;
  kind: "Driver" | "Supervisor";
  since: string;
  phone: string;
}

/** No GPS. A location is a reported fact with a time and a source, or nothing. */
export type ReportedLocation =
  | { state: "NO_REPORT" }
  | { state: "REPORTED"; place: string; observedAt: string; source: string };

export interface MeterSummary {
  odometerKm: number;
  observedAt: string;
  source: string;
  observedBy: string;
  km30d: number;
}

export type IssueStatus = "OPEN" | "IN_WORK" | "RESOLVED" | "DISMISSED";
export interface Issue {
  id: string;
  ref: string;
  title: string;
  description: string;
  safetyCritical: boolean;
  category: string;
  reportedAt: string;
  reportedBy: string;
  status: IssueStatus;
  workOrderRef: string | null;
  photos: number;
}

export type WorkOrderStatus = "SUBMITTED" | "OPEN" | "PENDING_CLOSE" | "CLOSED" | "CANCELLED";
export interface CostLine {
  label: string;
  kind: "Labour" | "Parts" | "External service";
  amountMinor: number;
  entryNumber: string | null;
  entryStatus: "POSTED" | "SUBMITTED" | null;
}
export interface WorkOrder {
  id: string;
  ref: string;
  title: string;
  status: WorkOrderStatus;
  issueRef: string | null;
  safetyCritical: boolean;
  assignee: string;
  createdAt: string;
  createdBy: string;
  dueBy: string | null;
  expectedCostMinor: number | null;
  actualCostMinor: number | null;
  completedAt: string | null;
  completedBy: string | null;
  summary: string | null;
  checklist: Array<{ label: string; done: boolean }>;
  costLines: CostLine[];
}

export type DocumentState = "VALID" | "EXPIRING" | "EXPIRED" | "NO_EXPIRY";
export interface VehicleDocument {
  id: string;
  type: string;
  number: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  state: DocumentState;
  daysLeft: number | null;
  hasFile: boolean;
  previousVersions: number;
}

export interface Trip {
  id: string;
  number: string;
  type: string;
  status: "OPEN" | "CLOSED";
  exceptions: number;
  customer: string | null;
  from: string;
  to: string;
  startedAt: string;
  endedAt: string | null;
  distanceKm: number | null;
  driver: string;
  revenueMinor: number | null;
  costMinor: number;
}

export type EntryStatus = "POSTED" | "SUBMITTED" | "REJECTED" | "REVERSED";
export interface MoneyEntry {
  id: string;
  number: string;
  economicDate: string;
  direction: "EXPENSE" | "REVENUE";
  category: string;
  layer: "DIRECT" | "MAINTENANCE" | "OWNERSHIP" | "SHARED";
  /** This vehicle's share (its posting lines), not the whole entry. */
  amountMinor: number;
  entryTotalMinor: number;
  status: EntryStatus;
  evidence: "ATTACHED" | "MISSING";
  counterparty: string | null;
  recordedBy: string;
  link: { kind: "WORK_ORDER" | "TRIP" | "DOCUMENT"; ref: string } | null;
}

export interface MoneySummary {
  period: string;
  periodLabel: string;
  postedExpenseMinor: number;
  pendingReviewMinor: number;
  pendingReviewCount: number;
  missingEvidenceCount: number;
  byCategory: Array<{ label: string; layer: MoneyEntry["layer"]; minor: number }>;
  monthly: Array<{ month: string; label: string; expenseMinor: number; revenueMinor: number }>;
  lifetime: { revenueMinor: number; expenseMinor: number; netMinor: number };
  costPerKm: { minor: number; basis: string } | null;
}

export interface Reading {
  id: string;
  valueKm: number;
  observedAt: string;
  source: "Manual" | "Trip start" | "Trip end" | "Work order";
  by: string;
  note?: string;
}

export interface AttentionItem {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  actionKey: ActionKeyRef;
  actionLabel: string;
  ref: string | null;
}

export type TimelineKind =
  | "ISSUE"
  | "GROUNDED"
  | "WORK_ORDER"
  | "RELEASED"
  | "EXPENSE"
  | "REVENUE"
  | "APPROVAL"
  | "REVERSAL"
  | "TRIP"
  | "READING"
  | "DOCUMENT"
  | "ASSIGNMENT"
  | "LIFECYCLE"
  | "NOTE";

export interface TimelineEvent {
  id: string;
  at: string;
  kind: TimelineKind;
  title: string;
  detail: string | null;
  actor: string;
  amountMinor: number | null;
  ref: string | null;
  tone: "neutral" | "critical" | "warning" | "success";
}

/** Mirrors ActionKey in actions.tsx; kept as a string to avoid an import cycle. */
export type ActionKeyRef = string;

export interface VehicleWorkspace {
  vehicle: VehicleIdentity;
  readiness: Readiness;
  custodian: Custodian | null;
  location: ReportedLocation;
  meter: MeterSummary;
  attention: AttentionItem[];
  issues: Issue[];
  workOrders: WorkOrder[];
  documents: VehicleDocument[];
  trips: Trip[];
  entries: MoneyEntry[];
  money: MoneySummary;
  readings: Reading[];
  timeline: TimelineEvent[];
  people: { technicians: string[]; drivers: string[]; garages: string[] };
}

export function formatXaf(minor: number, { signed = false }: { signed?: boolean } = {}): string {
  const n = new Intl.NumberFormat("en-US").format(Math.abs(minor));
  const sign = minor < 0 ? "−" : signed && minor > 0 ? "+" : "";
  return `${sign}${n} XAF`;
}

export function formatDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export function relativeDays(iso: string): string {
  const days = Math.round((Date.parse(`${TODAY}T12:00:00`) - Date.parse(`${iso.slice(0, 10)}T12:00:00`)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days === -1) return "tomorrow";
  if (days > 0) return `${days} days ago`;
  return `in ${-days} days`;
}

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  SUBMITTED: "Awaiting authorization",
  OPEN: "In progress",
  PENDING_CLOSE: "Awaiting sign-off",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  OPEN: "Open",
  IN_WORK: "In a work order",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
};

export const ENTRY_STATUS_LABELS: Record<EntryStatus, string> = {
  POSTED: "Posted",
  SUBMITTED: "Awaiting review",
  REJECTED: "Rejected",
  REVERSED: "Reversed",
};

export function buildWorkspace(asset: AssetDetail): VehicleWorkspace {
  const code = asset.assetCode;
  const vehicle: VehicleIdentity = {
    id: asset.id,
    code,
    displayName: [asset.manufacturer, asset.model].filter(Boolean).join(" ") || code,
    plate: asset.registrationNumber ?? "LT 482 AB",
    make: asset.manufacturer ?? "Mercedes-Benz",
    model: asset.model ?? "Actros 2644",
    year: asset.modelYear ?? 2019,
    chassis: asset.chassisNumber ?? "WDB9634031L912874",
    classLabel: asset.category.labelEn,
    templateCode: asset.templateCode,
    homeBranch: { code: asset.branch.code, name: asset.branch.name },
    lifecycle: asset.lifecycleStatus === "REGISTERED" ? "IN_SERVICE" : asset.lifecycleStatus,
    commissionedAt: asset.commissionedAt ?? "2024-03-11T08:00:00Z",
    acquisition: {
      date: asset.acquisitionDate ?? "2024-02-20",
      amountMinor: asset.acquisitionAmountMinor ?? 38_500_000,
    },
    capacity: "26 t payload",
    specs: [
      { label: "Axles", value: "3" },
      { label: "Body", value: "Flatbed with side rails" },
      { label: "Fuel", value: "Diesel · 400 L tank" },
      { label: "Tyres", value: "315/80 R22.5 × 10" },
    ],
  };

  const issues: Issue[] = [
    {
      id: "iss-31",
      ref: "SIG-0031",
      title: "Brake pressure warning on the Kekem descent",
      description:
        "Warning light came on twice going down to Kekem, pedal felt soft. Stopped at the checkpoint and called the depot.",
      safetyCritical: true,
      category: "Brakes",
      reportedAt: "2026-09-22T15:40:00Z",
      reportedBy: "Sali (driver)",
      status: "IN_WORK",
      workOrderRef: "OT-0014",
      photos: 2,
    },
    {
      id: "iss-33",
      ref: "SIG-0033",
      title: "Left mirror housing cracked",
      description: "Mirror still usable. Housing cracked after contact at the Bonaberi loading bay.",
      safetyCritical: false,
      category: "Body",
      reportedAt: "2026-09-24T07:15:00Z",
      reportedBy: "Sali (driver)",
      status: "OPEN",
      workOrderRef: null,
      photos: 1,
    },
    {
      id: "iss-27",
      ref: "SIG-0027",
      title: "Front tyres wearing unevenly",
      description: "Inner edge of both front tyres worn. Alignment suspected.",
      safetyCritical: false,
      category: "Tyres",
      reportedAt: "2026-09-10T09:00:00Z",
      reportedBy: "Hervé (technician)",
      status: "IN_WORK",
      workOrderRef: "OT-0013",
      photos: 0,
    },
    {
      id: "iss-19",
      ref: "SIG-0019",
      title: "Cab A/C not cooling",
      description: "A/C blows warm air after 20 minutes.",
      safetyCritical: false,
      category: "Comfort",
      reportedAt: "2026-08-18T11:20:00Z",
      reportedBy: "Jean Ngwa (driver)",
      status: "RESOLVED",
      workOrderRef: "OT-0009",
      photos: 0,
    },
  ];

  const workOrders: WorkOrder[] = [
    {
      id: "wo-14",
      ref: "OT-0014",
      title: "Brake system inspection and repair",
      status: "OPEN",
      issueRef: "SIG-0031",
      safetyCritical: true,
      assignee: "Hervé (technician)",
      createdAt: "2026-09-22T17:05:00Z",
      createdBy: "Boris (operations)",
      dueBy: "2026-09-26",
      expectedCostMinor: 450_000,
      actualCostMinor: null,
      completedAt: null,
      completedBy: null,
      summary: null,
      checklist: [
        { label: "Check air pressure and leaks", done: true },
        { label: "Inspect pads and discs, all axles", done: true },
        { label: "Replace front pads and brake chamber", done: false },
        { label: "Road test on a descent", done: false },
      ],
      costLines: [
        { label: "Brake pads (front axle) + chamber", kind: "Parts", amountMinor: 310_000, entryNumber: "DLA-2026-00009", entryStatus: "SUBMITTED" },
      ],
    },
    {
      id: "wo-13",
      ref: "OT-0013",
      title: "Front axle alignment and tyre rotation",
      status: "PENDING_CLOSE",
      issueRef: "SIG-0027",
      safetyCritical: false,
      assignee: "Garage Akwa (external)",
      createdAt: "2026-09-11T08:30:00Z",
      createdBy: "Hervé (technician)",
      dueBy: null,
      expectedCostMinor: 150_000,
      actualCostMinor: 180_000,
      completedAt: "2026-09-19T16:10:00Z",
      completedBy: "Hervé (technician)",
      summary: "Alignment corrected, front tyres swapped to rear. Toe-in was 6 mm out.",
      checklist: [
        { label: "Measure alignment", done: true },
        { label: "Adjust toe-in", done: true },
        { label: "Rotate tyres", done: true },
      ],
      costLines: [
        { label: "Alignment (Garage Akwa invoice GA-0917)", kind: "External service", amountMinor: 120_000, entryNumber: "DLA-2026-00008", entryStatus: "POSTED" },
        { label: "Labour, 4 h", kind: "Labour", amountMinor: 60_000, entryNumber: null, entryStatus: null },
      ],
    },
    {
      id: "wo-9",
      ref: "OT-0009",
      title: "A/C recharge and filter",
      status: "CLOSED",
      issueRef: "SIG-0019",
      safetyCritical: false,
      assignee: "Hervé (technician)",
      createdAt: "2026-08-18T14:00:00Z",
      createdBy: "Boris (operations)",
      dueBy: null,
      expectedCostMinor: 90_000,
      actualCostMinor: 85_000,
      completedAt: "2026-08-20T10:00:00Z",
      completedBy: "Hervé (technician)",
      summary: "Gas recharged, cabin filter replaced.",
      checklist: [],
      costLines: [
        { label: "Refrigerant + cabin filter", kind: "Parts", amountMinor: 85_000, entryNumber: "DLA-2026-00006", entryStatus: "POSTED" },
      ],
    },
    {
      id: "wo-10",
      ref: "OT-0010",
      title: "Replace wiper blades",
      status: "CANCELLED",
      issueRef: null,
      safetyCritical: false,
      assignee: "Hervé (technician)",
      createdAt: "2026-08-28T09:00:00Z",
      createdBy: "Hervé (technician)",
      dueBy: null,
      expectedCostMinor: 12_000,
      actualCostMinor: null,
      completedAt: null,
      completedBy: null,
      summary: "Cancelled: done by the driver with spare blades from stock.",
      checklist: [],
      costLines: [],
    },
  ];

  const documents: VehicleDocument[] = [
    { id: "doc-1", type: "Technical inspection (visite technique)", number: "VT-DLA-55120", issuedAt: "2026-03-22", expiresAt: "2026-09-22", state: "EXPIRED", daysLeft: -3, hasFile: true, previousVersions: 3 },
    { id: "doc-2", type: "Insurance", number: "AXA-CM-778120", issuedAt: "2025-10-07", expiresAt: "2026-10-07", state: "EXPIRING", daysLeft: 12, hasFile: true, previousVersions: 1 },
    { id: "doc-3", type: "Transport permit", number: "MINT-TP-2025-0412", issuedAt: "2025-01-15", expiresAt: "2027-01-14", state: "VALID", daysLeft: 476, hasFile: true, previousVersions: 0 },
    { id: "doc-4", type: "Registration (carte grise)", number: "LT 482 AB", issuedAt: "2024-02-28", expiresAt: null, state: "NO_EXPIRY", daysLeft: null, hasFile: false, previousVersions: 0 },
  ];

  const realTrips: Trip[] = asset.recentActivities.map((a, i) => ({
    id: a.id,
    number: a.activityNumber,
    type: a.activityType.labelEn,
    status: a.status === "CLOSED" ? "CLOSED" : "OPEN",
    exceptions: a.completeness === "COMPLETE_WITH_EXCEPTIONS" ? 2 : 0,
    customer: a.customerName,
    from: "Douala",
    to: i === 0 ? "Yaoundé" : "Garoua",
    startedAt: a.startedAt ?? "2026-07-14T05:00:00Z",
    endedAt: a.endedAt,
    distanceKm: a.endedAt ? 1_020 : null,
    driver: "Jean Ngwa",
    revenueMinor: i === 0 ? null : 2_850_000,
    costMinor: i === 0 ? 0 : 1_345_000,
  }));
  const trips: Trip[] = [
    {
      id: "trip-s1",
      number: "DLA-2026-00011",
      type: "Haulage job",
      status: "CLOSED",
      exceptions: 0,
      customer: "Brasseries du Cameroun",
      from: "Douala",
      to: "Bafoussam",
      startedAt: "2026-09-20T05:30:00Z",
      endedAt: "2026-09-22T19:10:00Z",
      distanceKm: 612,
      driver: "Sali",
      revenueMinor: 1_150_000,
      costMinor: 486_000,
    },
    ...realTrips,
  ];

  const entries: MoneyEntry[] = [
    { id: "e9", number: "DLA-2026-00009", economicDate: "2026-09-23", direction: "EXPENSE", category: "Repairs", layer: "MAINTENANCE", amountMinor: 310_000, entryTotalMinor: 310_000, status: "SUBMITTED", evidence: "ATTACHED", counterparty: "Tractafric Douala", recordedBy: "Hervé", link: { kind: "WORK_ORDER", ref: "OT-0014" } },
    { id: "e12", number: "DLA-2026-00012", economicDate: "2026-09-21", direction: "EXPENSE", category: "Fuel", layer: "DIRECT", amountMinor: 243_000, entryTotalMinor: 243_000, status: "POSTED", evidence: "MISSING", counterparty: "Tradex Bafoussam", recordedBy: "Sali", link: { kind: "TRIP", ref: "DLA-2026-00011" } },
    { id: "e11", number: "DLA-2026-00011", economicDate: "2026-09-20", direction: "EXPENSE", category: "Fuel", layer: "DIRECT", amountMinor: 198_000, entryTotalMinor: 198_000, status: "POSTED", evidence: "ATTACHED", counterparty: "Total Bonaberi", recordedBy: "Sali", link: { kind: "TRIP", ref: "DLA-2026-00011" } },
    { id: "e10", number: "DLA-2026-00010", economicDate: "2026-09-20", direction: "EXPENSE", category: "Tolls", layer: "DIRECT", amountMinor: 45_000, entryTotalMinor: 45_000, status: "POSTED", evidence: "ATTACHED", counterparty: null, recordedBy: "Sali", link: { kind: "TRIP", ref: "DLA-2026-00011" } },
    { id: "e8", number: "DLA-2026-00008", economicDate: "2026-09-18", direction: "EXPENSE", category: "Repairs", layer: "MAINTENANCE", amountMinor: 120_000, entryTotalMinor: 120_000, status: "POSTED", evidence: "ATTACHED", counterparty: "Garage Akwa", recordedBy: "Hervé", link: { kind: "WORK_ORDER", ref: "OT-0013" } },
    { id: "e7", number: "DLA-2026-00007", economicDate: "2026-09-05", direction: "EXPENSE", category: "Insurance", layer: "OWNERSHIP", amountMinor: 55_000, entryTotalMinor: 220_000, status: "POSTED", evidence: "ATTACHED", counterparty: "AXA Cameroun", recordedBy: "Émilienne", link: null },
    { id: "e13", number: "DLA-2026-00013", economicDate: "2026-09-21", direction: "REVENUE", category: "Freight revenue", layer: "DIRECT", amountMinor: 1_150_000, entryTotalMinor: 1_150_000, status: "POSTED", evidence: "ATTACHED", counterparty: "Brasseries du Cameroun", recordedBy: "Boris", link: { kind: "TRIP", ref: "DLA-2026-00011" } },
    { id: "e5", number: "DLA-2026-00005", economicDate: "2026-07-29", direction: "EXPENSE", category: "Repairs", layer: "MAINTENANCE", amountMinor: 450_000, entryTotalMinor: 450_000, status: "POSTED", evidence: "ATTACHED", counterparty: null, recordedBy: "Sali", link: null },
  ];

  const money: MoneySummary = {
    period: "2026-09",
    periodLabel: "September 2026",
    postedExpenseMinor: 661_000,
    pendingReviewMinor: 310_000,
    pendingReviewCount: 1,
    missingEvidenceCount: 1,
    byCategory: [
      { label: "Fuel", layer: "DIRECT", minor: 441_000 },
      { label: "Repairs", layer: "MAINTENANCE", minor: 120_000 },
      { label: "Insurance (share)", layer: "OWNERSHIP", minor: 55_000 },
      { label: "Tolls", layer: "DIRECT", minor: 45_000 },
    ],
    monthly: [
      { month: "2026-04", label: "Apr", expenseMinor: 812_000, revenueMinor: 2_400_000 },
      { month: "2026-05", label: "May", expenseMinor: 954_000, revenueMinor: 2_900_000 },
      { month: "2026-06", label: "Jun", expenseMinor: 701_000, revenueMinor: 2_150_000 },
      { month: "2026-07", label: "Jul", expenseMinor: 1_795_000, revenueMinor: 2_850_000 },
      { month: "2026-08", label: "Aug", expenseMinor: 612_000, revenueMinor: 1_980_000 },
      { month: "2026-09", label: "Sep", expenseMinor: 661_000, revenueMinor: 1_150_000 },
    ],
    lifetime: {
      revenueMinor: asset.finance.revenueMinor,
      expenseMinor: asset.finance.expenseMinor,
      netMinor: asset.finance.netMinor,
    },
    costPerKm: { minor: 452, basis: "Posted Sep expenses ÷ 1,462 km between readings (2 of 2 trips have start and end readings)" },
  };

  const readings: Reading[] = [
    { id: "r5", valueKm: 184_250, observedAt: "2026-09-23T08:10:00Z", source: "Work order", by: "Hervé", note: "At workshop intake, OT-0014" },
    { id: "r4", valueKm: 184_236, observedAt: "2026-09-22T19:10:00Z", source: "Trip end", by: "Sali" },
    { id: "r3", valueKm: 183_624, observedAt: "2026-09-20T05:30:00Z", source: "Trip start", by: "Sali" },
    { id: "r2", valueKm: 182_788, observedAt: "2026-09-02T07:00:00Z", source: "Manual", by: "Boris" },
    { id: "r1", valueKm: 181_130, observedAt: "2026-08-12T07:00:00Z", source: "Manual", by: "Boris" },
  ];

  const attention: AttentionItem[] = [
    { id: "a1", severity: "critical", title: "Grounded: brake pressure warning", detail: "Safety-critical report by Sali, 3 days ago. OT-0014 in progress, due tomorrow.", actionKey: "open-work-order", actionLabel: "Open OT-0014", ref: "OT-0014" },
    { id: "a2", severity: "critical", title: "Technical inspection expired", detail: "Expired 22 Sep. The truck cannot legally run until renewed.", actionKey: "renew-document", actionLabel: "Renew", ref: "doc-1" },
    { id: "a3", severity: "warning", title: "OT-0013 awaiting sign-off", detail: "Completed by Hervé. 180,000 XAF actual vs 150,000 expected.", actionKey: "approve-closure", actionLabel: "Review closure", ref: "OT-0013" },
    { id: "a4", severity: "warning", title: "Insurance expires in 12 days", detail: "AXA policy AXA-CM-778120 ends 7 Oct.", actionKey: "renew-document", actionLabel: "Renew", ref: "doc-2" },
    { id: "a5", severity: "warning", title: "Fuel receipt missing", detail: "DLA-2026-00012 · 243,000 XAF at Tradex Bafoussam, recorded by Sali.", actionKey: "attach-receipt", actionLabel: "Attach receipt", ref: "DLA-2026-00012" },
    { id: "a6", severity: "info", title: "Brake parts awaiting finance review", detail: "DLA-2026-00009 · 310,000 XAF, linked to OT-0014.", actionKey: "review-entry", actionLabel: "Review", ref: "DLA-2026-00009" },
  ];

  const timeline: TimelineEvent[] = [
    { id: "t1", at: "2026-09-24T07:15:00Z", kind: "ISSUE", title: "Issue reported: left mirror housing cracked", detail: "SIG-0033 · not safety-critical · 1 photo", actor: "Sali", amountMinor: null, ref: "SIG-0033", tone: "neutral" },
    { id: "t2", at: "2026-09-23T10:40:00Z", kind: "EXPENSE", title: "Brake parts recorded, awaiting review", detail: "DLA-2026-00009 · Tractafric Douala · linked to OT-0014", actor: "Hervé", amountMinor: 310_000, ref: "DLA-2026-00009", tone: "warning" },
    { id: "t3", at: "2026-09-23T08:10:00Z", kind: "READING", title: "Odometer 184,250 km", detail: "At workshop intake", actor: "Hervé", amountMinor: null, ref: null, tone: "neutral" },
    { id: "t4", at: "2026-09-22T19:10:00Z", kind: "TRIP", title: "Trip closed: Douala → Bafoussam", detail: "DLA-2026-00011 · 612 km · Brasseries du Cameroun", actor: "Sali", amountMinor: null, ref: "DLA-2026-00011", tone: "success" },
    { id: "t5", at: "2026-09-22T17:05:00Z", kind: "WORK_ORDER", title: "Work order opened: brake system inspection", detail: "OT-0014 · assigned to Hervé · expected 450,000 XAF", actor: "Boris", amountMinor: null, ref: "OT-0014", tone: "neutral" },
    { id: "t6", at: "2026-09-22T15:40:00Z", kind: "GROUNDED", title: "Grounded after a safety-critical report", detail: "SIG-0031 · brake pressure warning on the Kekem descent · 2 photos", actor: "Sali", amountMinor: null, ref: "SIG-0031", tone: "critical" },
    { id: "t7", at: "2026-09-22T00:00:00Z", kind: "DOCUMENT", title: "Technical inspection expired", detail: "VT-DLA-55120", actor: "System", amountMinor: null, ref: "doc-1", tone: "critical" },
    { id: "t8", at: "2026-09-21T13:00:00Z", kind: "REVENUE", title: "Freight revenue posted", detail: "DLA-2026-00013 · Brasseries du Cameroun", actor: "Boris", amountMinor: 1_150_000, ref: "DLA-2026-00013", tone: "success" },
    { id: "t9", at: "2026-09-21T12:20:00Z", kind: "EXPENSE", title: "Fuel, 243,000 XAF, no receipt", detail: "DLA-2026-00012 · Tradex Bafoussam", actor: "Sali", amountMinor: 243_000, ref: "DLA-2026-00012", tone: "warning" },
    { id: "t10", at: "2026-09-20T05:30:00Z", kind: "TRIP", title: "Trip started: Douala → Bafoussam", detail: "Odometer 183,624 km · driver Sali", actor: "Sali", amountMinor: null, ref: "DLA-2026-00011", tone: "neutral" },
    { id: "t11", at: "2026-09-19T16:10:00Z", kind: "WORK_ORDER", title: "OT-0013 completed, awaiting sign-off", detail: "Alignment corrected · actual 180,000 XAF (expected 150,000)", actor: "Hervé", amountMinor: 180_000, ref: "OT-0013", tone: "warning" },
    { id: "t12", at: "2026-09-18T15:00:00Z", kind: "EXPENSE", title: "Garage Akwa alignment invoice posted", detail: "DLA-2026-00008 · linked to OT-0013", actor: "Hervé", amountMinor: 120_000, ref: "DLA-2026-00008", tone: "neutral" },
    { id: "t13", at: "2026-09-05T09:30:00Z", kind: "EXPENSE", title: "Insurance premium, this truck's share", detail: "DLA-2026-00007 · 55,000 of 220,000 XAF split across 4 trucks", actor: "Émilienne", amountMinor: 55_000, ref: "DLA-2026-00007", tone: "neutral" },
    { id: "t14", at: "2026-09-02T07:00:00Z", kind: "READING", title: "Odometer 182,788 km", detail: "Monthly check", actor: "Boris", amountMinor: null, ref: null, tone: "neutral" },
    { id: "t15", at: "2026-08-28T09:00:00Z", kind: "ASSIGNMENT", title: "Custodian changed to Jean Ngwa", detail: "From Sali · home branch unchanged (Douala)", actor: "Boris", amountMinor: null, ref: null, tone: "neutral" },
    { id: "t16", at: "2026-08-20T10:00:00Z", kind: "RELEASED", title: "OT-0009 closed: A/C recharged", detail: "85,000 XAF", actor: "Hervé", amountMinor: 85_000, ref: "OT-0009", tone: "success" },
    { id: "t17", at: "2026-07-30T10:00:00Z", kind: "REVERSAL", title: "Duplicate fuel entry reversed", detail: "DLA-2026-00004R reverses DLA-2026-00004 · reason: entered twice", actor: "Émilienne", amountMinor: -180_000, ref: "DLA-2026-00004", tone: "neutral" },
    { id: "t18", at: "2026-07-29T16:00:00Z", kind: "APPROVAL", title: "Repair approved and posted", detail: "DLA-2026-00005 · 450,000 XAF", actor: "Émilienne", amountMinor: 450_000, ref: "DLA-2026-00005", tone: "success" },
    { id: "t19", at: "2024-03-11T08:00:00Z", kind: "LIFECYCLE", title: "Commissioned into service", detail: "Home branch Douala", actor: "Émilienne", amountMinor: null, ref: null, tone: "success" },
    { id: "t20", at: "2024-02-28T08:00:00Z", kind: "LIFECYCLE", title: `Registered as ${code}`, detail: "Acquired 20 Feb 2024 · 38,500,000 XAF", actor: "Émilienne", amountMinor: null, ref: null, tone: "neutral" },
  ];

  return {
    vehicle,
    readiness: {
      state: "GROUNDED",
      since: "2026-09-22T15:40:00Z",
      reason: "Brake pressure warning on the Kekem descent",
      issueRef: "SIG-0031",
      workOrderRef: "OT-0014",
      reportedBy: "Sali (driver)",
    },
    custodian: { name: "Jean Ngwa", kind: "Driver", since: "2026-08-28", phone: "+237 6 77 41 20 18" },
    location: { state: "REPORTED", place: "Douala depot workshop", observedAt: "2026-09-23T08:10:00Z", source: "Work order intake" },
    meter: { odometerKm: 184_250, observedAt: "2026-09-23T08:10:00Z", source: "Work order", observedBy: "Hervé", km30d: 1_462 },
    attention,
    issues,
    workOrders,
    documents,
    trips,
    entries,
    money,
    readings,
    timeline,
    people: {
      technicians: ["Hervé (technician)", "Mbarga (technician)"],
      drivers: ["Jean Ngwa", "Sali", "Patrice"],
      garages: ["Garage Akwa", "Tractafric Douala"],
    },
  };
}
