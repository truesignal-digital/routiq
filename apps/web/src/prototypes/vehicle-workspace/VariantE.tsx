// PROTOTYPE — throwaway, issue #44. Variant E: "A, refined".
// A's skeleton (identity on top, sections as tabs, a panel for any record),
// rebuilt to explain itself: one status sentence with one next step, a to-do
// list on Now, one place per action, and forms that open inside the record
// they act on so there is never more than one overlay.

import { Fragment, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDollarSign,
  CircleQuestionMark,
  CircleX,
  ClipboardCheck,
  Clock,
  Ellipsis,
  Eye,
  FileExclamationPoint,
  FileText,
  Flag,
  Gauge,
  Hourglass,
  Info,
  LayoutGrid,
  Lock,
  OctagonAlert,
  Paperclip,
  Receipt,
  Route,
  Search,
  ShieldAlert,
  ShieldCheck,
  StickyNote,
  TriangleAlert,
  Truck,
  Undo2,
  UserRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { ACTIONS, StatusNote, actionByKey, useVehicleActions, type ActionGroup, type ActionKey, type VehicleAction } from "./actions.js";
import {
  ENTRY_STATUS_LABELS,
  ISSUE_STATUS_LABELS,
  TODAY,
  WORK_ORDER_STATUS_LABELS,
  formatDate,
  formatDateTime,
  formatXaf,
  relativeDays,
  type AttentionItem,
  type EntryStatus,
  type Issue,
  type MoneyEntry,
  type ProtoRole,
  type TimelineEvent,
  type TimelineKind,
  type Trip,
  type VehicleDocument,
  type VehicleWorkspace,
  type WorkOrder,
  type WorkOrderStatus,
} from "./mockData.js";

// ---------------------------------------------------------------------------
// Types and vocabulary

type Tone = "neutral" | "success" | "warning" | "info" | "danger";
type TabKey = "now" | "maintenance" | "money" | "trips" | "documents" | "history";
type RefHint = "entry" | "trip";
type Field = ReturnType<VehicleAction["fields"]>[number];

type Detail =
  | { kind: "work-order"; ref: string }
  | { kind: "issue"; ref: string }
  | { kind: "entry"; number: string }
  | { kind: "trip"; number: string }
  | { kind: "document"; id: string }
  | { kind: "readings" };

/** The panel is a stack of pages: records, and a record's form on top of it. */
type Page = { kind: "record"; detail: Detail } | { kind: "form"; key: ActionKey; ref: string | null };

interface Step {
  key: ActionKey;
  label: string;
  ref: string | null;
}

interface Locked {
  step: Step;
  reason: string;
}

interface MenuStep {
  step: Step;
  locked?: string | undefined;
}

/** What this role does next on a work order: act, wait for a prerequisite, or nothing. */
type RoleStep = { kind: "go"; step: Step } | ({ kind: "locked" } & Locked) | { kind: "none" };

interface Todo {
  item: AttentionItem;
  record: Detail | null;
  step: Step | null;
  who: string;
}

interface Ctx {
  ws: VehicleWorkspace;
  role: ProtoRole;
  readOnly: boolean;
  can: (key: ActionKey) => boolean;
  /** Actions with no record around them: the shared action sheet. */
  act: (key: ActionKey, ref?: string | null) => void;
  /** Open a record in the panel, or follow a ref inside it. */
  show: (detail: Detail) => void;
  /** Open a record with one of its forms already on top: [record, form]. */
  actOn: (detail: Detail, step: Step) => void;
  goTo: (tab: TabKey) => void;
  openAll: () => void;
  ticks: Record<string, boolean[]>;
  tick: (ref: string, index: number, done: boolean) => void;
}

type FlowRole = "workshop" | "finance" | "manager" | "admin" | "none";

/** Where each role sits in problem → work order → sign-off → release. */
const FLOW_ROLE: Record<ProtoRole, FlowRole> = {
  ADMIN: "admin",
  OPS_MANAGER: "manager",
  MAINTENANCE: "workshop",
  FINANCE_APPROVER: "finance",
  FIELD_SUBMITTER: "none",
  EXECUTIVE_VIEWER: "none",
};

/** Buttons in the identity strip: what this role does most, nothing else. */
const HEADER_ACTIONS: Record<ProtoRole, readonly ActionKey[]> = {
  FIELD_SUBMITTER: ["log-fuel", "report-issue"],
  MAINTENANCE: ["report-issue"],
  ADMIN: ["record-expense"],
  OPS_MANAGER: ["record-expense"],
  FINANCE_APPROVER: ["record-expense"],
  EXECUTIVE_VIEWER: [],
};

/** Phone bottom bar: the first three this role can take right now. */
const BAR_PLAN: Record<ProtoRole, readonly ActionKey[]> = {
  FIELD_SUBMITTER: ["log-fuel", "report-issue", "record-reading", "start-trip"],
  MAINTENANCE: ["complete-work-order", "create-work-order", "report-issue", "add-note"],
  OPS_MANAGER: ["record-expense", "report-issue", "start-trip", "renew-document"],
  ADMIN: ["record-expense", "report-issue", "start-trip", "renew-document"],
  FINANCE_APPROVER: ["review-entry", "record-expense", "attach-receipt", "reverse-entry"],
  EXECUTIVE_VIEWER: [],
};

const GROUP_FIRST: Record<ProtoRole, ActionGroup | null> = {
  ADMIN: null,
  OPS_MANAGER: "Operations",
  FINANCE_APPROVER: "Money",
  MAINTENANCE: "Maintenance",
  FIELD_SUBMITTER: "Capture",
  EXECUTIVE_VIEWER: null,
};

/** Where the catalog's first sentence does not say what the action does. */
const SHORT_DESCRIPTIONS: Partial<Record<ActionKey, string>> = {
  "record-reading": "Today's odometer, with an optional dashboard photo.",
  "report-issue": "Something is wrong with the vehicle. Safety-critical grounds it at once.",
  "cancel-work-order": "Stop a work order that is no longer needed. A reason is required.",
  "transfer-branch": "Move the vehicle's home branch for good. Past costs stay where they were.",
  "renew-document": "Record the new version of a document. The old one is kept.",
  "record-revenue": "Freight or fares earned with this vehicle.",
  "schedule-service": "A reminder every N km or N days, such as an oil change every 20,000 km.",
};

const LIFECYCLE_LABELS: Record<string, string> = {
  REGISTERED: "Registered",
  IN_SERVICE: "In service",
  UNDER_MAINTENANCE: "Under maintenance",
  SOLD: "Sold",
  RETIRED: "Retired",
  WRITTEN_OFF: "Written off",
};

const LAYER_LABELS: Record<MoneyEntry["layer"], string> = {
  DIRECT: "Direct",
  MAINTENANCE: "Maintenance",
  OWNERSHIP: "Ownership",
  SHARED: "Shared",
};

const WO_TONE: Record<WorkOrderStatus, Tone> = {
  SUBMITTED: "warning",
  OPEN: "info",
  PENDING_CLOSE: "warning",
  CLOSED: "success",
  CANCELLED: "neutral",
};
const WO_ICON: Record<WorkOrderStatus, LucideIcon> = {
  SUBMITTED: Clock,
  OPEN: Wrench,
  PENDING_CLOSE: ClipboardCheck,
  CLOSED: CircleCheck,
  CANCELLED: Ban,
};

const ENTRY_TONE: Record<EntryStatus, Tone> = { POSTED: "neutral", SUBMITTED: "warning", REJECTED: "danger", REVERSED: "neutral" };
const ENTRY_ICON: Record<EntryStatus, LucideIcon> = { POSTED: Check, SUBMITTED: Clock, REJECTED: CircleX, REVERSED: Undo2 };

const KIND_ICON: Record<TimelineKind, LucideIcon> = {
  ISSUE: TriangleAlert,
  GROUNDED: ShieldAlert,
  WORK_ORDER: Wrench,
  RELEASED: ShieldCheck,
  EXPENSE: Receipt,
  REVENUE: CircleDollarSign,
  APPROVAL: BadgeCheck,
  REVERSAL: Undo2,
  TRIP: Route,
  READING: Gauge,
  DOCUMENT: FileText,
  ASSIGNMENT: UserRound,
  LIFECYCLE: Flag,
  NOTE: StickyNote,
};

const EVENT_TONE_CLASS: Record<TimelineEvent["tone"], string> = {
  neutral: "bg-muted text-muted-foreground",
  critical: "bg-destructive/10 text-destructive",
  warning: "bg-warning/15 text-warning-foreground",
  success: "bg-success/15 text-success-foreground",
};

const ICON_TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-muted text-foreground/80",
  danger: "bg-destructive/10 text-destructive",
  warning: "bg-warning/15 text-warning-foreground",
  success: "bg-success/15 text-success-foreground",
};

const REF_HINT: Partial<Record<TimelineKind, RefHint>> = {
  EXPENSE: "entry",
  REVENUE: "entry",
  APPROVAL: "entry",
  REVERSAL: "entry",
  TRIP: "trip",
};

const HISTORY_FILTERS: ReadonlyArray<{ key: string; label: string; kinds: readonly TimelineKind[] | null }> = [
  { key: "all", label: "All", kinds: null },
  { key: "maintenance", label: "Maintenance", kinds: ["ISSUE", "GROUNDED", "WORK_ORDER", "RELEASED"] },
  { key: "money", label: "Money", kinds: ["EXPENSE", "REVENUE", "APPROVAL", "REVERSAL"] },
  { key: "trips", label: "Trips", kinds: ["TRIP"] },
  { key: "documents", label: "Documents", kinds: ["DOCUMENT"] },
  { key: "readings", label: "Readings", kinds: ["READING"] },
  { key: "assignments", label: "Assignments", kinds: ["ASSIGNMENT"] },
  { key: "lifecycle", label: "Lifecycle and notes", kinds: ["LIFECYCLE", "NOTE"] },
];

const ENTRY_FILTERS: ReadonlyArray<{ key: string; label: string; test: (e: MoneyEntry) => boolean }> = [
  { key: "all", label: "All", test: () => true },
  { key: "expense", label: "Expenses", test: (e) => e.direction === "EXPENSE" },
  { key: "revenue", label: "Revenue", test: (e) => e.direction === "REVENUE" },
  { key: "review", label: "Awaiting review", test: (e) => e.status === "SUBMITTED" },
  { key: "receipt", label: "Missing receipt", test: (e) => e.evidence === "MISSING" },
];

const SEVERITY_RANK: Record<AttentionItem["severity"], number> = { critical: 0, warning: 1, info: 2 };

// ---------------------------------------------------------------------------
// Helpers

function isActionKey(key: string): key is ActionKey {
  return ACTIONS.some((a) => a.key === key);
}
function toDate(iso: string): Date {
  return new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
}
function shortDay(iso: string): string {
  return toDate(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function timeOf(iso: string): string {
  return toDate(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function dayKey(iso: string): string {
  return toDate(iso).toLocaleDateString("en-CA");
}
function monthYear(iso: string): string {
  return toDate(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}
function daysFromToday(iso: string): number {
  return Math.round((Date.parse(`${iso.slice(0, 10)}T12:00:00`) - Date.parse(`${TODAY}T12:00:00`)) / 86_400_000);
}
function dueLabel(iso: string): string {
  const d = daysFromToday(iso);
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  if (d > 1) return `due in ${d} days`;
  return d === -1 ? "1 day overdue" : `${-d} days overdue`;
}
function km(n: number): string {
  return `${n.toLocaleString("en-US")} km`;
}
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
function monthLabel(month: string): string {
  return new Date(`${month}-15T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}
function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
/** "Hervé (technician)" → "Hervé". */
function shortName(person: string): string {
  return person.replace(/\s*\(.*\)\s*$/, "");
}
function docName(doc: VehicleDocument): string {
  return doc.type.replace(/\s*\(.*\)\s*$/, "");
}
function shortDescription(a: VehicleAction): string {
  const override = SHORT_DESCRIPTIONS[a.key];
  if (override) return override;
  const m = a.description.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : a.description).trim();
}
function vehicleNoun(ws: VehicleWorkspace): string {
  return ws.vehicle.classLabel.toLowerCase();
}

const isActiveWo = (w: WorkOrder) => w.status !== "CLOSED" && w.status !== "CANCELLED";
const isOpenIssue = (i: Issue) => i.status === "OPEN" || i.status === "IN_WORK";

function resolveRef(ws: VehicleWorkspace, ref: string, hint?: RefHint): Detail | null {
  if (ws.workOrders.some((w) => w.ref === ref)) return { kind: "work-order", ref };
  if (ws.issues.some((i) => i.ref === ref)) return { kind: "issue", ref };
  if (ws.documents.some((d) => d.id === ref)) return { kind: "document", id: ref };
  const isEntry = ws.entries.some((e) => e.number === ref);
  const isTrip = ws.trips.some((t) => t.number === ref);
  if (hint === "trip") return isTrip ? { kind: "trip", number: ref } : null;
  if (hint === "entry") return isEntry ? { kind: "entry", number: ref } : null;
  if (isEntry) return { kind: "entry", number: ref };
  if (isTrip) return { kind: "trip", number: ref };
  return null;
}

function detailLabel(ws: VehicleWorkspace, d: Detail): string {
  switch (d.kind) {
    case "work-order":
    case "issue":
      return d.ref;
    case "entry":
      return d.number;
    case "trip":
      return `Trip ${d.number}`;
    case "document": {
      const doc = ws.documents.find((x) => x.id === d.id);
      return doc?.number ?? doc?.type ?? "Document";
    }
    case "readings":
      return "Odometer readings";
  }
}

/** The line that keeps a record visible above its form. */
function recordTitle(ws: VehicleWorkspace, d: Detail): string {
  switch (d.kind) {
    case "work-order": {
      const wo = ws.workOrders.find((w) => w.ref === d.ref);
      return wo ? `${wo.ref} · ${wo.title}` : d.ref;
    }
    case "issue": {
      const issue = ws.issues.find((i) => i.ref === d.ref);
      return issue ? `${issue.ref} · ${issue.title}` : d.ref;
    }
    case "entry": {
      const e = ws.entries.find((x) => x.number === d.number);
      return e ? `${e.number} · ${e.category} · ${formatXaf(e.amountMinor)}` : d.number;
    }
    case "trip": {
      const t = ws.trips.find((x) => x.number === d.number);
      return t ? `Trip ${t.number} · ${t.from} → ${t.to}` : `Trip ${d.number}`;
    }
    case "document": {
      const doc = ws.documents.find((x) => x.id === d.id);
      return doc ? `${docName(doc)}${doc.number ? ` · ${doc.number}` : ""}` : "Document";
    }
    case "readings":
      return "Odometer readings";
  }
}

function groundingWo(ws: VehicleWorkspace): WorkOrder | undefined {
  const r = ws.readiness;
  return r.state === "GROUNDED" && r.workOrderRef ? ws.workOrders.find((w) => w.ref === r.workOrderRef) : undefined;
}

function isGroundingWo(ws: VehicleWorkspace, wo: WorkOrder): boolean {
  return ws.readiness.state === "GROUNDED" && ws.readiness.workOrderRef === wo.ref;
}

/** The flow's next step on a work order, whoever takes it. */
function nextWoStep(ws: VehicleWorkspace, wo: WorkOrder): Step | null {
  switch (wo.status) {
    case "SUBMITTED":
      return { key: "approve-work-order", label: "Authorize", ref: wo.ref };
    case "OPEN":
      return { key: "complete-work-order", label: "Complete work", ref: wo.ref };
    case "PENDING_CLOSE":
      return { key: "approve-closure", label: "Sign off", ref: wo.ref };
    case "CLOSED":
      return isGroundingWo(ws, wo) ? { key: "release-to-service", label: "Release to service", ref: wo.ref } : null;
    case "CANCELLED":
      return null;
  }
}

/** This role's own step on a work order, or the prerequisite it is waiting for. */
function roleStepForWo(ws: VehicleWorkspace, wo: WorkOrder, role: ProtoRole): RoleStep {
  const flow = FLOW_ROLE[role];
  const grounding = isGroundingWo(ws, wo);
  const managing = flow === "manager" || flow === "admin";
  const release: Step = { key: "release-to-service", label: "Release to service", ref: wo.ref };
  const signOff: Step = { key: "approve-closure", label: "Sign off", ref: wo.ref };
  const complete: Step = { key: "complete-work-order", label: "Complete work", ref: wo.ref };
  switch (wo.status) {
    case "SUBMITTED":
      if (flow === "finance" || flow === "admin") return { kind: "go", step: { key: "approve-work-order", label: "Authorize", ref: wo.ref } };
      if (flow === "workshop") return { kind: "locked", step: complete, reason: `Needs finance to authorize ${wo.ref} first` };
      if (managing && grounding) return { kind: "locked", step: release, reason: `Needs ${wo.ref} authorized, completed and signed off` };
      return { kind: "none" };
    case "OPEN":
      if (flow === "workshop") return { kind: "go", step: complete };
      if (flow === "finance") return { kind: "locked", step: signOff, reason: `Needs ${wo.ref} completed first` };
      if (managing && grounding) return { kind: "locked", step: release, reason: `Needs ${wo.ref} completed and signed off` };
      return { kind: "none" };
    case "PENDING_CLOSE":
      if (flow === "finance" || flow === "admin") return { kind: "go", step: signOff };
      if (managing && grounding) return { kind: "locked", step: release, reason: `Needs ${wo.ref} signed off` };
      return { kind: "none" };
    case "CLOSED":
      return managing && grounding ? { kind: "go", step: release } : { kind: "none" };
    case "CANCELLED":
      return { kind: "none" };
  }
}

/** Who the work order is waiting on, in words. Null when nobody. */
function woWaiting(ws: VehicleWorkspace, wo: WorkOrder): string | null {
  switch (wo.status) {
    case "SUBMITTED":
      return "Waiting on finance to authorize the spending.";
    case "OPEN":
      return `Waiting on ${shortName(wo.assignee)} to complete the work.`;
    case "PENDING_CLOSE":
      return "Waiting on finance to sign off the work and its cost.";
    case "CLOSED":
      return isGroundingWo(ws, wo) ? "Waiting on a manager to release the vehicle to service." : null;
    case "CANCELLED":
      return null;
  }
}

function woMenu(ctx: Ctx, wo: WorkOrder): MenuStep[] {
  const out: MenuStep[] = [];
  const rs = roleStepForWo(ctx.ws, wo, ctx.role);
  if (rs.kind === "go" && ctx.can(rs.step.key)) out.push({ step: rs.step });
  const next = nextWoStep(ctx.ws, wo);
  if (next && ctx.can(next.key) && !out.some((o) => o.step.key === next.key)) out.push({ step: next });
  if ((wo.status === "OPEN" || wo.status === "PENDING_CLOSE") && ctx.can("record-expense")) out.push({ step: { key: "record-expense", label: "Add a cost", ref: wo.ref } });
  if ((wo.status === "SUBMITTED" || wo.status === "OPEN") && ctx.can("cancel-work-order")) out.push({ step: { key: "cancel-work-order", label: "Cancel work order", ref: wo.ref } });
  if (rs.kind === "locked" && ctx.can(rs.step.key)) out.push({ step: rs.step, locked: rs.reason });
  return out;
}

function entryActions(e: MoneyEntry): Step[] {
  const steps: Step[] = [];
  if (e.evidence === "MISSING") steps.push({ key: "attach-receipt", label: "Attach receipt", ref: e.number });
  if (e.status === "SUBMITTED") steps.push({ key: "review-entry", label: "Review", ref: e.number });
  if (e.status === "POSTED") steps.push({ key: "reverse-entry", label: "Reverse", ref: e.number });
  return steps;
}

function entryWaiting(ctx: Ctx, e: MoneyEntry): string | null {
  if (e.status === "SUBMITTED" && !ctx.can("review-entry")) return "Waiting on finance to review it. Until then it is not counted in posted totals.";
  if (e.evidence === "MISSING" && !ctx.can("attach-receipt")) return `Waiting on ${e.recordedBy} to attach the receipt.`;
  return null;
}

function tripActions(trip: Trip): Step[] {
  return [
    ...(trip.status === "OPEN" ? [{ key: "log-fuel" as const, label: "Log fuel", ref: trip.number }] : []),
    { key: "record-expense", label: "Add a cost", ref: trip.number },
  ];
}

function docActions(doc: VehicleDocument): Step[] {
  return doc.expiresAt ? [{ key: "renew-document", label: "Renew", ref: doc.id }] : [];
}

function checklistOf(ctx: Ctx, wo: WorkOrder): Array<{ label: string; done: boolean }> {
  const ticks = ctx.ticks[wo.ref];
  return wo.checklist.map((c, i) => ({ ...c, done: ticks?.[i] ?? c.done }));
}

/** Form values the catalog expects: some selects want the full option text. */
function prefill(ws: VehicleWorkspace, key: ActionKey, ref: string | null): string | null {
  if (!ref) return null;
  if (key === "create-work-order") {
    const issue = ws.issues.find((i) => i.ref === ref);
    return issue ? `${issue.ref} · ${issue.title}` : ref;
  }
  if (key === "record-expense") {
    const wo = ws.workOrders.find((w) => w.ref === ref);
    if (wo) return `${wo.ref} · ${wo.title}`;
    const trip = ws.trips.find((t) => t.number === ref);
    if (trip) return `${trip.number} · trip`;
  }
  return ref;
}

/** The record an action most likely means when it is started without one. */
function contextRef(ws: VehicleWorkspace, key: ActionKey): string | null {
  const gwo = groundingWo(ws);
  switch (key) {
    case "complete-work-order":
    case "cancel-work-order":
      return (gwo && gwo.status === "OPEN" ? gwo : ws.workOrders.find((w) => w.status === "OPEN"))?.ref ?? null;
    case "approve-work-order":
      return ws.workOrders.find((w) => w.status === "SUBMITTED")?.ref ?? null;
    case "approve-closure":
      return ws.workOrders.find((w) => w.status === "PENDING_CLOSE")?.ref ?? null;
    case "release-to-service":
      return gwo?.ref ?? null;
    case "create-work-order":
      return ws.issues.find((i) => i.status === "OPEN" && !i.workOrderRef)?.ref ?? null;
    case "review-entry":
      return ws.entries.find((e) => e.status === "SUBMITTED")?.number ?? null;
    case "attach-receipt":
      return ws.entries.find((e) => e.evidence === "MISSING")?.number ?? null;
    case "renew-document":
      return (ws.documents.find((d) => d.state === "EXPIRED") ?? ws.documents.find((d) => d.state === "EXPIRING"))?.id ?? null;
    default:
      return null;
  }
}

/** Why an action cannot be taken on this vehicle right now, whoever asks. */
function globalLock(ws: VehicleWorkspace, key: ActionKey): string | null {
  switch (key) {
    case "release-to-service": {
      if (ws.readiness.state !== "GROUNDED") return `The ${vehicleNoun(ws)} is not grounded`;
      const wo = groundingWo(ws);
      if (!wo || wo.status === "CANCELLED") return "Needs a work order, completed and signed off";
      if (wo.status === "PENDING_CLOSE") return `Needs ${wo.ref} signed off`;
      if (wo.status !== "CLOSED") return `Needs ${wo.ref} completed and signed off`;
      return null;
    }
    case "complete-work-order":
      return ws.workOrders.some((w) => w.status === "OPEN") ? null : "No work order in progress";
    case "approve-closure":
      return ws.workOrders.some((w) => w.status === "PENDING_CLOSE") ? null : "No completed work waiting for sign-off";
    case "approve-work-order":
      return ws.workOrders.some((w) => w.status === "SUBMITTED") ? null : "Nothing waiting for authorization";
    case "review-entry":
      return ws.entries.some((e) => e.status === "SUBMITTED") ? null : "Nothing waiting for review";
    case "attach-receipt":
      return ws.entries.some((e) => e.evidence === "MISSING") ? null : "No entry is missing a receipt";
    case "cancel-work-order":
      return ws.workOrders.some((w) => w.status === "SUBMITTED" || w.status === "OPEN") ? null : "No open work order";
    case "commission":
      return ws.vehicle.lifecycle === "REGISTERED" ? null : "Already in service";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// To-dos: attention items, problems nobody planned, entries waiting for review

function waitingOn(ws: VehicleWorkspace, item: AttentionItem): string {
  switch (item.actionKey) {
    case "approve-closure":
    case "review-entry":
    case "approve-work-order":
    case "reverse-entry":
      return "Finance";
    case "renew-document":
    case "add-document":
      return "Operations";
    case "create-work-order":
      return "Workshop";
    case "release-to-service":
      return "A manager";
    case "attach-receipt":
      return ws.entries.find((e) => e.number === item.ref)?.recordedBy ?? "Whoever paid";
    case "open-work-order": {
      const wo = ws.workOrders.find((w) => w.ref === item.ref);
      if (!wo) return "Workshop";
      if (wo.status === "OPEN") return shortName(wo.assignee);
      if (wo.status === "SUBMITTED" || wo.status === "PENDING_CLOSE") return "Finance";
      return "A manager";
    }
    default:
      return "Others";
  }
}

function todoStep(ctx: Ctx, item: AttentionItem): Step | null {
  const key = item.actionKey;
  if (key === "open-work-order") {
    const wo = ctx.ws.workOrders.find((w) => w.ref === item.ref);
    const rs = wo ? roleStepForWo(ctx.ws, wo, ctx.role) : null;
    return rs?.kind === "go" && ctx.can(rs.step.key) ? rs.step : null;
  }
  if (!isActionKey(key) || !ctx.can(key)) return null;
  return { key, label: key === "approve-closure" ? "Sign off" : item.actionLabel, ref: item.ref };
}

/** Everything that needs someone, except the grounding: the status sentence owns that. */
function buildTodos(ctx: Ctx): Todo[] {
  const { ws } = ctx;
  const r = ws.readiness;
  const owned = r.state === "GROUNDED" ? [r.issueRef, r.workOrderRef].filter((x): x is string => x !== null) : [];
  const known = (ref: string) => ws.attention.some((a) => a.ref === ref);
  const unplanned: AttentionItem[] = ws.issues
    .filter((i) => i.status === "OPEN" && !i.workOrderRef && !known(i.ref))
    .map((i) => ({
      id: `issue-${i.id}`,
      severity: i.safetyCritical ? "critical" : "warning",
      title: `${i.ref} has no work order`,
      detail: `${i.title}. Reported by ${i.reportedBy}, ${relativeDays(i.reportedAt)}.`,
      actionKey: "create-work-order",
      actionLabel: "Create work order",
      ref: i.ref,
    }));
  const reviews: AttentionItem[] = ws.entries
    .filter((e) => e.status === "SUBMITTED" && !known(e.number))
    .map((e) => ({
      id: `review-${e.id}`,
      severity: "info",
      title: `${e.category} awaiting review`,
      detail: `${e.number} · ${formatXaf(e.amountMinor)}, recorded by ${e.recordedBy}.`,
      actionKey: "review-entry",
      actionLabel: "Review",
      ref: e.number,
    }));
  return [...ws.attention, ...unplanned, ...reviews]
    .filter((item) => item.ref === null || !owned.includes(item.ref))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .map((item) => ({
      item,
      record: item.ref ? resolveRef(ws, item.ref) : null,
      step: todoStep(ctx, item),
      who: waitingOn(ws, item),
    }));
}

// ---------------------------------------------------------------------------
// Page

export function VariantE({ ws }: { ws: VehicleWorkspace }) {
  const actions = useVehicleActions(ws);
  const [tab, setTab] = useState<TabKey>("now");
  const [stack, setStack] = useState<Page[]>([]);
  const [ticks, setTicks] = useState<Record<string, boolean[]>>({});
  const [allOpen, setAllOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const ctx: Ctx = {
    ws,
    role: actions.role,
    readOnly: actions.available.length === 0,
    can: actions.can,
    act: (key, ref = null) => {
      setStack([]);
      setAllOpen(false);
      actions.open(key, prefill(ws, key, ref));
    },
    show: (detail) => setStack((s) => [...s, { kind: "record", detail }]),
    actOn: (detail, step) =>
      setStack([
        { kind: "record", detail },
        { kind: "form", key: step.key, ref: step.ref },
      ]),
    goTo: (next) => {
      setTab(next);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    openAll: () => setAllOpen(true),
    ticks,
    tick: (ref, index, done) =>
      setTicks((t) => {
        const wo = ws.workOrders.find((w) => w.ref === ref);
        const next = [...(t[ref] ?? wo?.checklist.map((c) => c.done) ?? [])];
        next[index] = done;
        return { ...t, [ref]: next };
      }),
  };

  const todos = buildTodos(ctx);
  const mine = ctx.readOnly ? [] : todos.filter((t) => t.step !== null);
  const workWaitsOnYou = !ctx.readOnly && ws.workOrders.some((wo) => roleStepForWo(ws, wo, ctx.role).kind === "go");

  return (
    <PageContainer width="wide" className="pb-48 md:pb-28">
      <header className="space-y-2.5">
        <IdentityStrip ctx={ctx} detailsOpen={detailsOpen} onToggleDetails={() => setDetailsOpen((o) => !o)} />
        <StatusBlock ctx={ctx} />
        <FactsLine ctx={ctx} open={detailsOpen} onToggle={() => setDetailsOpen((o) => !o)} />
        {detailsOpen && <DetailsCard ctx={ctx} />}
      </header>

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)} className="mt-5 gap-5">
        <div className="sticky top-14 z-[5] -mx-4 overflow-x-auto bg-background px-4 shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none] sm:mx-0 sm:px-0">
          <TabsList variant="line" className="h-11 w-max gap-6 p-0">
            <TabItem value="now" label="Now" marker={mine.length > 0 ? <NumberMarker n={mine.length} /> : null} />
            <TabItem value="maintenance" label="Maintenance" marker={workWaitsOnYou ? <DotMarker /> : null} />
            <TabItem value="money" label="Money" />
            <TabItem value="trips" label="Trips" />
            <TabItem value="documents" label="Documents" />
            <TabItem value="history" label="History" />
          </TabsList>
        </div>

        <TabsContent value="now">
          <NowTab ctx={ctx} todos={todos} />
        </TabsContent>
        <TabsContent value="maintenance">
          <MaintenanceTab ctx={ctx} />
        </TabsContent>
        <TabsContent value="money">
          <MoneyTab ctx={ctx} />
        </TabsContent>
        <TabsContent value="trips">
          <TripsTab ctx={ctx} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsTab ctx={ctx} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab ctx={ctx} />
        </TabsContent>
      </Tabs>

      <BottomBar ctx={ctx} />
      <RecordPanel ctx={ctx} stack={stack} setStack={setStack} />
      <AllActionsSheet ctx={ctx} open={allOpen} onOpenChange={setAllOpen} byGroup={actions.byGroup} />
      {actions.sheet}
    </PageContainer>
  );
}

function TabItem({ value, label, marker }: { value: TabKey; label: string; marker?: ReactNode }) {
  return (
    <TabsTrigger value={value} className="h-full flex-none gap-1.5 px-0.5 text-sm group-data-horizontal/tabs:after:bottom-0">
      {label}
      {marker}
    </TabsTrigger>
  );
}

function NumberMarker({ n }: { n: number }) {
  return (
    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-foreground px-1 text-[11px] font-semibold text-background tabular-nums">
      {n}
      <span className="sr-only"> to do</span>
    </span>
  );
}

function DotMarker() {
  return (
    <span className="relative -top-1.5 size-1.5 rounded-full bg-foreground">
      <span className="sr-only">Needs you</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Small shared pieces

function Sep() {
  return (
    <span aria-hidden className="text-muted-foreground/50">
      ·
    </span>
  );
}

function Count({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-5 items-center rounded-md bg-muted px-1.5 text-xs font-medium text-muted-foreground tabular-nums">{children}</span>;
}

function LinkButton({ onClick, children, className }: { onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "rounded-sm font-medium text-foreground tabular-nums underline decoration-foreground/25 underline-offset-[3px] transition-colors hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      {children}
    </button>
  );
}

function RefButton({ ctx, refId, hint, className }: { ctx: Ctx; refId: string; hint?: RefHint | undefined; className?: string }) {
  const detail = resolveRef(ctx.ws, refId, hint);
  if (!detail) return <span className={cn("tabular-nums", className)}>{refId}</span>;
  return (
    <LinkButton onClick={() => ctx.show(detail)} {...(className ? { className } : {})}>
      {detailLabel(ctx.ws, detail)}
    </LinkButton>
  );
}

function WoStatus({ status }: { status: WorkOrderStatus }) {
  return (
    <StatusBadge tone={WO_TONE[status]} icon={WO_ICON[status]} className="rounded-md">
      {WORK_ORDER_STATUS_LABELS[status]}
    </StatusBadge>
  );
}

function EntryStatusBadge({ status }: { status: EntryStatus }) {
  return (
    <StatusBadge tone={ENTRY_TONE[status]} icon={ENTRY_ICON[status]} className="rounded-md">
      {ENTRY_STATUS_LABELS[status]}
    </StatusBadge>
  );
}

function SafetyMark() {
  return (
    <span className="inline-flex items-center gap-1 font-medium text-destructive">
      <ShieldAlert className="size-3.5" aria-hidden />
      Safety-critical
    </span>
  );
}

function Evidence({ state }: { state: MoneyEntry["evidence"] }) {
  return state === "ATTACHED" ? (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Paperclip className="size-3.5" aria-hidden />
      Receipt attached
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
      <TriangleAlert className="size-3.5" aria-hidden />
      No receipt
    </span>
  );
}

function DocState({ doc }: { doc: VehicleDocument }) {
  switch (doc.state) {
    case "EXPIRED":
      return (
        <StatusBadge tone="danger" className="rounded-md">
          Expired
        </StatusBadge>
      );
    case "EXPIRING":
      return (
        <StatusBadge tone="warning" className="rounded-md">
          Expires in {doc.daysLeft} days
        </StatusBadge>
      );
    case "VALID":
      return (
        <StatusBadge tone="success" className="rounded-md">
          Valid
        </StatusBadge>
      );
    case "NO_EXPIRY":
      return (
        <StatusBadge tone="neutral" icon={Circle} className="rounded-md">
          No expiry date
        </StatusBadge>
      );
  }
}

function TripState({ trip }: { trip: Trip }) {
  if (trip.status === "OPEN")
    return (
      <StatusBadge tone="info" icon={Route} className="rounded-md">
        On the road
      </StatusBadge>
    );
  if (trip.exceptions > 0)
    return (
      <StatusBadge tone="warning" icon={TriangleAlert} className="rounded-md">
        Closed, {plural(trip.exceptions, "gap")}
      </StatusBadge>
    );
  return (
    <StatusBadge tone="success" className="rounded-md">
      Closed
    </StatusBadge>
  );
}

function SeverityIcon({ severity, className }: { severity: AttentionItem["severity"]; className?: string }) {
  const Icon = severity === "critical" ? OctagonAlert : severity === "warning" ? TriangleAlert : Info;
  return (
    <Icon
      className={cn(
        "size-4 shrink-0",
        severity === "critical" && "text-destructive",
        severity === "warning" && "text-amber-600 dark:text-amber-400",
        severity === "info" && "text-sky-600 dark:text-sky-400",
        className,
      )}
      aria-label={severity === "critical" ? "Urgent" : severity === "warning" ? "Soon" : "For information"}
    />
  );
}

function RowIcon({ icon: Icon, tone = "neutral" }: { icon: LucideIcon; tone?: Tone }) {
  return (
    <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", ICON_TONE_CLASS[tone])}>
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

function CardHead({ title, aside, description }: { title: ReactNode; aside?: ReactNode; description?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {aside}
    </div>
  );
}

/** A tab's title, one line of explanation, and its single primary button. */
function TabHeader({ title, description, action }: { title: string; description: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function SubHead({ title, count, description }: { title: string; count?: number; description?: string }) {
  return (
    <div className="mb-2.5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {title}
        {count !== undefined && <Count>{count}</Count>}
      </h3>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

/** The one primary button a tab carries. Record-less, so it uses the shared action sheet. */
function TabAction({ ctx, actionKey }: { ctx: Ctx; actionKey: ActionKey }) {
  if (!ctx.can(actionKey)) return null;
  const a = actionByKey(actionKey);
  return (
    <Button className="h-10 self-start sm:h-9 sm:self-auto" onClick={() => ctx.act(actionKey, contextRef(ctx.ws, actionKey))}>
      <a.icon aria-hidden />
      {a.label}
    </Button>
  );
}

function FilterChips<K extends string>({ options, value, onChange }: { options: ReadonlyArray<{ key: K; label: string; count: number }>; value: K; onChange: (key: K) => void }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <div role="radiogroup" className="flex w-max gap-1.5">
        {options.map((o) => {
          const active = o.key === value;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={o.count === 0 && !active}
              onClick={() => onChange(o.key)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors disabled:opacity-40",
                active ? "border-foreground/20 bg-muted font-medium text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {o.label}
              <span className="text-xs tabular-nums text-muted-foreground">{o.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One row anatomy for every list: what it is · status · amount or date · "…"

function RecordRow({
  icon,
  title,
  detail,
  status,
  aside,
  menu,
  onOpen,
  muted = false,
}: {
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  status?: ReactNode;
  aside?: ReactNode;
  menu?: ReactNode;
  onOpen?: () => void;
  muted?: boolean;
}) {
  return (
    <li
      onClick={onOpen}
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[auto_minmax(0,1fr)_11.5rem_10rem_1.75rem] md:items-center md:gap-x-4",
        onOpen && "cursor-pointer transition-colors hover:bg-muted/40",
      )}
    >
      <div className="col-start-1 row-start-1">{icon}</div>
      <div className="col-start-2 row-start-1 min-w-0 self-center">
        {onOpen ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className={cn("rounded-sm text-left font-medium leading-snug focus-visible:outline-2 focus-visible:outline-ring", muted && "text-muted-foreground")}
          >
            {title}
          </button>
        ) : (
          <p className="font-medium leading-snug">{title}</p>
        )}
        {detail && <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>}
      </div>
      {(status || aside) && (
        <div className="col-start-2 row-start-2 flex items-start justify-between gap-3 md:contents">
          <div className="min-w-0 md:col-start-3 md:row-start-1">{status}</div>
          <div className="shrink-0 text-right text-sm tabular-nums md:col-start-4 md:row-start-1">{aside}</div>
        </div>
      )}
      <div className="col-start-3 row-start-1 flex justify-end self-start md:col-start-5 md:self-center">
        {menu ?? (onOpen ? <ChevronRight className="mt-1.5 size-4 text-muted-foreground md:mt-0" aria-hidden /> : null)}
      </div>
    </li>
  );
}

function RowMenu({ ctx, detail, label, steps }: { ctx: Ctx; detail: Detail; label: string; steps: MenuStep[] }) {
  if (steps.length === 0) return <ChevronRight className="mt-1.5 size-4 text-muted-foreground md:mt-0" aria-hidden />;
  const open = steps.filter((s) => !s.locked);
  const locked = steps.filter((s) => s.locked);
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Actions for ${label}`} />}>
          <Ellipsis aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {open.map(({ step }) => {
            const Icon = actionByKey(step.key).icon;
            return (
              <DropdownMenuItem key={step.key} className="py-1.5" onClick={() => ctx.actOn(detail, step)}>
                <Icon className="text-muted-foreground" aria-hidden />
                {step.label}
              </DropdownMenuItem>
            );
          })}
          {open.length > 0 && locked.length > 0 && <DropdownMenuSeparator />}
          {locked.map(({ step, locked: reason }) => (
            <DropdownMenuItem key={step.key} disabled className="items-start py-1.5">
              <Lock className="mt-0.5 text-muted-foreground" aria-hidden />
              <span className="grid">
                <span>{step.label}</span>
                <span className="text-xs text-muted-foreground">{reason}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header: identity strip, the status sentence, one quiet line of facts

function IdentityStrip({ ctx, detailsOpen, onToggleDetails }: { ctx: Ctx; detailsOpen: boolean; onToggleDetails: () => void }) {
  const v = ctx.ws.vehicle;
  const name = [v.make, v.model].filter(Boolean).join(" ") || v.displayName;
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground/80">
        <Truck className="size-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-x-2.5">
          <h1 className="text-base leading-snug font-semibold tracking-tight md:truncate md:text-lg">
            <span className="tabular-nums">{v.code}</span>
            <span className="mx-1.5 font-normal text-muted-foreground/60">·</span>
            {name}
          </h1>
          <span className="hidden shrink-0 items-center gap-2.5 text-sm text-muted-foreground md:inline-flex">
            <Sep />
            <Plate plate={v.plate} />
            <Sep />
            <span>Home: {v.homeBranch.name}</span>
          </span>
        </div>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground md:hidden">
          <Plate plate={v.plate} />
          <Sep />
          <span>Home: {v.homeBranch.name}</span>
        </p>
      </div>
      <HeaderActions ctx={ctx} />
      <Button
        variant="ghost"
        size="sm"
        className="h-9 shrink-0 text-muted-foreground md:hidden"
        aria-expanded={detailsOpen}
        onClick={onToggleDetails}
      >
        Details
        <ChevronDown className={cn("transition-transform", detailsOpen && "rotate-180")} aria-hidden />
      </Button>
    </div>
  );
}

function Plate({ plate }: { plate: string | null }) {
  if (!plate) return <span>No plate</span>;
  return <span className="rounded-[5px] border border-foreground/25 px-1.5 text-xs leading-5 font-semibold tracking-wide text-foreground tabular-nums">{plate}</span>;
}

function HeaderActions({ ctx }: { ctx: Ctx }) {
  if (ctx.readOnly) {
    return (
      <span className="hidden shrink-0 items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground md:inline-flex">
        <Eye className="size-3.5" aria-hidden />
        View only
      </span>
    );
  }
  const keys = HEADER_ACTIONS[ctx.role].filter((k) => ctx.can(k));
  return (
    <div className="hidden shrink-0 items-center gap-2 md:flex">
      {keys.map((k) => {
        const a = actionByKey(k);
        return (
          <Button key={k} variant="outline" className="h-9" onClick={() => ctx.act(k, contextRef(ctx.ws, k))}>
            <a.icon aria-hidden />
            {a.label}
          </Button>
        );
      })}
      <Button variant="outline" className="h-9" onClick={ctx.openAll}>
        <LayoutGrid aria-hidden />
        More actions
      </Button>
    </div>
  );
}

/** The grounding step for this role: the one button beside the status sentence. */
function groundingStep(ctx: Ctx): { step: RoleStep; record: Detail | null } {
  const { ws, role } = ctx;
  const r = ws.readiness;
  if (r.state !== "GROUNDED" || ctx.readOnly) return { step: { kind: "none" }, record: null };
  const wo = groundingWo(ws);
  if (!wo || wo.status === "CANCELLED") {
    const flow = FLOW_ROLE[role];
    const plan: Step = { key: "create-work-order", label: "Create work order", ref: r.issueRef };
    const canPlan = (flow === "workshop" || flow === "manager" || flow === "admin") && ctx.can("create-work-order");
    return { step: canPlan ? { kind: "go", step: plan } : { kind: "none" }, record: { kind: "issue", ref: r.issueRef } };
  }
  return { step: roleStepForWo(ws, wo, role), record: { kind: "work-order", ref: wo.ref } };
}

function StatusBlock({ ctx }: { ctx: Ctx }) {
  const { ws } = ctx;
  const r = ws.readiness;
  const v = ws.vehicle;
  const noun = vehicleNoun(ws);

  let tone: "critical" | "success" | "neutral" = "neutral";
  let Icon: LucideIcon = CircleQuestionMark;
  let lead = "";
  let follow: ReactNode = null;
  const notes: ReactNode[] = [];

  if (r.state === "GROUNDED") {
    tone = "critical";
    Icon = ShieldAlert;
    const days = -daysFromToday(r.since);
    const when = days <= 0 ? "Grounded since today" : days === 1 ? "Grounded since yesterday" : `Grounded for ${days} days`;
    const reason = lowerFirst(r.reason);
    lead = `${when} after ${/^[aeiou]/i.test(reason) ? "an" : "a"} ${reason}.`;
    const wo = groundingWo(ws);
    const woRef = wo ? <RefButton ctx={ctx} refId={wo.ref} /> : null;
    if (!wo || wo.status === "CANCELLED") {
      follow = (
        <>
          Nobody has planned the repair yet: <RefButton ctx={ctx} refId={r.issueRef} /> has no work order.
        </>
      );
    } else if (wo.status === "SUBMITTED") {
      follow = <>The repair ({woRef}) is waiting for finance to authorize it.</>;
    } else if (wo.status === "OPEN") {
      follow = (
        <>
          Waiting on {shortName(wo.assignee)} to finish the repair ({woRef}
          {wo.dueBy ? `, ${dueLabel(wo.dueBy)}` : ""}).
        </>
      );
    } else if (wo.status === "PENDING_CLOSE") {
      follow = <>The repair is done; waiting on finance to sign off {woRef}.</>;
    } else {
      follow = <>The repair ({woRef}) is signed off; waiting on a manager to release it to service.</>;
    }
    if (FLOW_ROLE[ctx.role] === "none" && !ctx.readOnly) {
      notes.push(
        <>
          <Ban className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <span>Do not drive it until a manager releases it to service.</span>
        </>,
      );
    }
  } else if (r.state === "AVAILABLE") {
    tone = "success";
    Icon = ShieldCheck;
    lead = "Available.";
    const last = [...ws.trips].sort((a, b) => (b.endedAt ?? b.startedAt).localeCompare(a.endedAt ?? a.startedAt))[0];
    const since = v.commissionedAt ? `In service since ${toDate(v.commissionedAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}` : "Not commissioned yet";
    follow = last ? `${since}; last trip ${relativeDays(last.endedAt ?? last.startedAt)}.` : `${since}; no trips yet.`;
  } else {
    lead = "Availability not recorded.";
    follow = "Nobody has marked this vehicle available or grounded yet.";
  }

  // Other hard stops, taken from the attention list.
  for (const item of ws.attention) {
    if (item.severity !== "critical" || (r.state === "GROUNDED" && (item.ref === r.workOrderRef || item.ref === r.issueRef))) continue;
    const doc = item.ref ? ws.documents.find((d) => d.id === item.ref) : undefined;
    notes.push(
      <>
        <FileExclamationPoint className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        {doc && doc.expiresAt ? (
          <span>
            Also: the <LinkButton onClick={() => ctx.show({ kind: "document", id: doc.id })}>{lowerFirst(docName(doc))}</LinkButton> expired{" "}
            {relativeDays(doc.expiresAt)}, so the {noun} cannot legally run until it is renewed.
          </span>
        ) : (
          <span>Also: {lowerFirst(item.title)}.</span>
        )}
      </>,
    );
  }

  const { step, record } = groundingStep(ctx);

  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-3 rounded-xl border px-4 py-3 md:flex-row md:items-start md:gap-8",
        tone === "critical" && "border-destructive/25 bg-destructive/[0.04] dark:bg-destructive/10",
        tone === "success" && "border-emerald-600/25 bg-emerald-500/[0.05] dark:bg-emerald-500/10",
        tone === "neutral" && "bg-muted/40",
      )}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <Icon
          className={cn(
            "mt-0.5 size-5 shrink-0 md:mt-1",
            tone === "critical" && "text-destructive",
            tone === "success" && "text-emerald-600 dark:text-emerald-400",
            tone === "neutral" && "text-muted-foreground",
          )}
          aria-hidden
        />
        <div className="min-w-0 space-y-1.5">
          <p className="text-base leading-snug text-pretty md:text-lg md:leading-snug">
            <span className="font-semibold">{lead}</span> <span className="text-foreground/80">{follow}</span>
          </p>
          {notes.map((n, i) => (
            <p key={i} className="flex gap-1.5 text-sm text-foreground/80">
              {n}
            </p>
          ))}
        </div>
      </div>
      <StatusAction ctx={ctx} step={step} record={record} />
    </div>
  );
}

function StatusAction({ ctx, step, record }: { ctx: Ctx; step: RoleStep; record: Detail | null }) {
  if (!record || step.kind === "none") return null;
  if (step.kind === "go") {
    const Icon = actionByKey(step.step.key).icon;
    const wo = record.kind === "work-order" ? ctx.ws.workOrders.find((w) => w.ref === record.ref) : undefined;
    const list = wo ? checklistOf(ctx, wo) : [];
    const caption = step.step.key === "complete-work-order" && list.length > 0 ? `${list.filter((c) => c.done).length} of ${list.length} checklist steps done` : null;
    return (
      <div className="flex shrink-0 flex-col gap-1.5 pl-8 md:items-end md:pl-0">
        <Button className="h-10 md:h-9" onClick={() => ctx.actOn(record, step.step)}>
          <Icon aria-hidden />
          {step.step.label}
        </Button>
        {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
      </div>
    );
  }
  return (
    <div className="flex shrink-0 flex-col gap-1.5 pl-8 md:max-w-64 md:items-end md:pl-0">
      <Button variant="outline" className="h-10 bg-background md:h-9" onClick={() => ctx.show(record)}>
        Open {detailLabel(ctx.ws, record)}
        <ArrowRight aria-hidden />
      </Button>
      <p className="text-xs text-muted-foreground md:text-right">
        <Lock className="mr-1 inline size-3 align-[-1px]" aria-hidden />
        {step.step.label}: {lowerFirst(step.reason)}.
      </p>
    </div>
  );
}

function FactsLine({ ctx, open, onToggle }: { ctx: Ctx; open: boolean; onToggle: () => void }) {
  const { ws } = ctx;
  const v = ws.vehicle;
  return (
    <div className="hidden items-center gap-x-2.5 gap-y-1 px-1 text-sm text-muted-foreground md:flex md:flex-wrap">
      <span>
        Custodian <span className="font-medium text-foreground">{ws.custodian ? ws.custodian.name : "none"}</span>
      </span>
      <Sep />
      <span>
        Odometer <LinkButton onClick={() => ctx.show({ kind: "readings" })}>{km(ws.meter.odometerKm)}</LinkButton>, {relativeDays(ws.meter.observedAt)}
      </span>
      <Sep />
      {ws.location.state === "REPORTED" ? (
        <span>
          Reported at <span className="font-medium text-foreground">{ws.location.place}</span>, {relativeDays(ws.location.observedAt)}
        </span>
      ) : (
        <span>Location: no report</span>
      )}
      <Sep />
      <span>
        <span className="font-medium text-foreground">{LIFECYCLE_LABELS[v.lifecycle] ?? v.lifecycle}</span>
        {v.commissionedAt ? ` since ${monthYear(v.commissionedAt)}` : ""}
      </span>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        {open ? "Hide details" : "Details"}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
    </div>
  );
}

function DetailsCard({ ctx }: { ctx: Ctx }) {
  const { ws } = ctx;
  const v = ws.vehicle;
  const r = ws.readiness;
  const now: Array<[string, ReactNode]> = [
    [
      "Availability",
      r.state === "GROUNDED" ? (
        <>
          Grounded since {formatDateTime(r.since)} · <RefButton ctx={ctx} refId={r.issueRef} />
        </>
      ) : r.state === "AVAILABLE" ? (
        `Available since ${formatDateTime(r.since)}`
      ) : (
        "Not recorded"
      ),
    ],
    ["Lifecycle", `${LIFECYCLE_LABELS[v.lifecycle] ?? v.lifecycle}${v.commissionedAt ? ` since ${formatDate(v.commissionedAt)}` : ""}`],
    ["Home branch", `${v.homeBranch.name}, administrative home`],
    ["Custodian", ws.custodian ? `${ws.custodian.name}, ${ws.custodian.kind.toLowerCase()} since ${shortDay(ws.custodian.since)} · ${ws.custodian.phone}` : "Nobody assigned"],
    [
      "Reported location",
      ws.location.state === "REPORTED" ? `${ws.location.place} · ${formatDateTime(ws.location.observedAt)} · ${ws.location.source}` : "No report. Locations are reported by people, not GPS.",
    ],
    [
      "Odometer",
      <>
        <LinkButton onClick={() => ctx.show({ kind: "readings" })}>{km(ws.meter.odometerKm)}</LinkButton> · {shortDay(ws.meter.observedAt)}, {ws.meter.source.toLowerCase()}, {ws.meter.observedBy}
        <span className="block text-xs font-normal text-muted-foreground">{km(ws.meter.km30d)} in the last 30 days</span>
      </>,
    ],
  ];
  const vehicle: Array<[string, ReactNode]> = [
    ["Fleet code", v.code],
    ["Plate", v.plate ?? "Not recorded"],
    ["Make and model", [v.make, v.model].filter(Boolean).join(" ") || "Not recorded"],
    ["Year", v.year ?? "Not recorded"],
    ["Class", v.classLabel],
    ["Chassis number", <span className="break-all">{v.chassis ?? "Not recorded"}</span>],
    ["Capacity", v.capacity ?? "Not recorded"],
    ["Acquired", v.acquisition.date ? `${formatDate(v.acquisition.date)}${v.acquisition.amountMinor !== null ? ` · ${formatXaf(v.acquisition.amountMinor)}` : ""}` : "Not recorded"],
  ];
  return (
    <Card className="gap-0 py-0">
      <div className="grid divide-y md:grid-cols-[1.25fr_1fr_0.8fr] md:divide-x md:divide-y-0">
        <DetailsColumn title="Right now" rows={now} />
        <DetailsColumn title="Vehicle" rows={vehicle} />
        <DetailsColumn title="Specifications" rows={v.specs.map((s) => [s.label, s.value] as [string, ReactNode])} />
      </div>
    </Card>
  );
}

function DetailsColumn({ title, rows }: { title: string; rows: Array<[string, ReactNode]> }) {
  return (
    <section className="p-4">
      <h2 className="mb-2.5 text-xs font-medium text-muted-foreground">{title}</h2>
      <dl className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([k, val]) => (
          <Fragment key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 font-medium">{val}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Now: to-do, this month, recent

function NowTab({ ctx, todos }: { ctx: Ctx; todos: Todo[] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      {ctx.readOnly ? <AttentionReadOnly ctx={ctx} todos={todos} /> : <TodoCard ctx={ctx} todos={todos} besidesHeader={groundingStep(ctx).step.kind === "go"} />}
      <div className="space-y-6">
        <MonthCard ctx={ctx} />
        <RecentCard ctx={ctx} />
      </div>
    </div>
  );
}

function TodoCard({ ctx, todos, besidesHeader }: { ctx: Ctx; todos: Todo[]; besidesHeader: boolean }) {
  const mine = todos.filter((t) => t.step !== null);
  const others = todos.filter((t) => t.step === null);
  return (
    <Card className="gap-0 py-0">
      <CardHead
        title={
          <>
            To do {mine.length > 0 && <Count>{mine.length}</Count>}
          </>
        }
        description={besidesHeader ? "Besides the repair above, what needs you on this vehicle." : "What needs you on this vehicle, most urgent first."}
      />
      {mine.length === 0 ? (
        <div className="flex items-start gap-3 px-4 py-5">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-foreground" aria-hidden />
          <div>
            <p className="text-sm font-medium">{besidesHeader ? "Nothing else needs you on this vehicle." : "Nothing needs you right now."}</p>
            <p className="text-sm text-muted-foreground">When something does, it shows up here with one button to handle it.</p>
          </div>
        </div>
      ) : (
        <ul className="divide-y">
          {mine.map((t) => (
            <TodoRow key={t.item.id} ctx={ctx} todo={t} />
          ))}
        </ul>
      )}
      {others.length > 0 && <WaitingOnOthers ctx={ctx} todos={others} />}
    </Card>
  );
}

function TodoRow({ ctx, todo }: { ctx: Ctx; todo: Todo }) {
  const { item, record, step } = todo;
  if (!step) return null;
  const Icon = actionByKey(step.key).icon;
  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      <SeverityIcon severity={item.severity} className="mt-1" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          {record ? (
            <button
              type="button"
              onClick={() => ctx.show(record)}
              className="rounded-sm text-left font-medium leading-snug hover:underline hover:decoration-foreground/30 hover:underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-ring"
            >
              {item.title}
            </button>
          ) : (
            <p className="font-medium leading-snug">{item.title}</p>
          )}
          <p className="mt-0.5 text-sm text-muted-foreground">{item.detail}</p>
        </div>
        <Button
          variant="outline"
          className="h-9 self-start sm:h-8 sm:self-center"
          onClick={() => (record ? ctx.actOn(record, step) : ctx.act(step.key, step.ref))}
        >
          <Icon aria-hidden />
          {step.label}
        </Button>
      </div>
    </li>
  );
}

function WaitingOnOthers({ ctx, todos }: { ctx: Ctx; todos: Todo[] }) {
  const [open, setOpen] = useState(false);
  const names = [...new Set(todos.map((t) => t.who))];
  return (
    <div className="border-t">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40"
      >
        <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden />
        <span className="font-medium">Waiting on others</span>
        <Count>{todos.length}</Count>
        <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">{names.join(", ")}</span>
      </button>
      {open && (
        <ul className="divide-y border-t bg-muted/20">
          {todos.map((t) => (
            <WaitingRow key={t.item.id} ctx={ctx} todo={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

function WaitingRow({ ctx, todo }: { ctx: Ctx; todo: Todo }) {
  const { item, record, who } = todo;
  const body = (
    <>
      <SeverityIcon severity={item.severity} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-snug font-medium">{item.title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{item.detail}</span>
      </span>
      <span className="shrink-0 pl-2 text-right text-xs text-muted-foreground">
        Waiting on
        <span className="block font-medium text-foreground">{who}</span>
      </span>
    </>
  );
  return (
    <li>
      {record ? (
        <button type="button" onClick={() => ctx.show(record)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50">
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-3 px-4 py-2.5">{body}</div>
      )}
    </li>
  );
}

function AttentionReadOnly({ ctx, todos }: { ctx: Ctx; todos: Todo[] }) {
  return (
    <Card className="gap-0 py-0">
      <CardHead
        title={
          <>
            Needs attention {todos.length > 0 && <Count>{todos.length}</Count>}
          </>
        }
        description="Open items on this vehicle and who is handling each one."
      />
      {todos.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">Nothing needs attention on this vehicle.</p>
      ) : (
        <ul className="divide-y">
          {todos.map((t) => (
            <WaitingRow key={t.item.id} ctx={ctx} todo={t} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function MonthCard({ ctx }: { ctx: Ctx }) {
  const m = ctx.ws.money;
  const rows: Array<{ label: string; value: string; hint: string; warn: boolean }> = [
    { label: "Posted expenses", value: formatXaf(m.postedExpenseMinor), hint: "Posted is not the same as paid", warn: false },
    {
      label: "Awaiting review",
      value: formatXaf(m.pendingReviewMinor),
      hint: `${plural(m.pendingReviewCount, "entry", "entries")}, not counted in posted`,
      warn: m.pendingReviewCount > 0,
    },
    { label: "Missing receipts", value: plural(m.missingEvidenceCount, "entry", "entries"), hint: "Recorded without proof", warn: m.missingEvidenceCount > 0 },
  ];
  return (
    <Card className="gap-0 py-0">
      <CardHead
        title={m.periodLabel}
        description="This vehicle's share"
        aside={
          <Button variant="ghost" size="sm" className="-my-1 -mr-1.5 text-muted-foreground" onClick={() => ctx.goTo("money")}>
            See money
            <ArrowRight aria-hidden />
          </Button>
        }
      />
      <dl className="divide-y">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <dt className="flex items-center gap-1.5 text-sm">
                {r.warn && <TriangleAlert className="size-3.5 text-amber-600 dark:text-amber-400" aria-hidden />}
                {r.label}
              </dt>
              <dd className="text-xs text-muted-foreground">{r.hint}</dd>
            </div>
            <dd className="shrink-0 text-sm font-semibold tabular-nums">{r.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function RecentCard({ ctx }: { ctx: Ctx }) {
  const events = [...ctx.ws.timeline].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  return (
    <Card className="gap-0 py-0">
      <CardHead
        title="Recent"
        aside={
          <Button variant="ghost" size="sm" className="-my-1 -mr-1.5 text-muted-foreground" onClick={() => ctx.goTo("history")}>
            See all history
            <ArrowRight aria-hidden />
          </Button>
        }
      />
      <ol className="divide-y">
        {events.map((e) => (
          <CompactEvent key={e.id} ctx={ctx} event={e} />
        ))}
      </ol>
    </Card>
  );
}

function CompactEvent({ ctx, event }: { ctx: Ctx; event: TimelineEvent }) {
  const Icon = KIND_ICON[event.kind];
  const target = event.ref ? resolveRef(ctx.ws, event.ref, REF_HINT[event.kind]) : null;
  const body = (
    <>
      <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md", EVENT_TONE_CLASS[event.tone])}>
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-snug">{event.title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {event.actor} · {formatDateTime(event.at)}
        </span>
      </span>
    </>
  );
  return (
    <li>
      {target ? (
        <button type="button" onClick={() => ctx.show(target)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40">
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-3 px-4 py-2.5">{body}</div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Maintenance

function MaintenanceTab({ ctx }: { ctx: Ctx }) {
  const { ws } = ctx;
  const [showDone, setShowDone] = useState(false);
  const unplanned = ws.issues.filter((i) => i.status === "OPEN" && !i.workOrderRef);
  const active = ws.workOrders.filter(isActiveWo);
  const doneWos = ws.workOrders.filter((w) => !isActiveWo(w));
  const doneIssues = ws.issues.filter((i) => !isOpenIssue(i));

  return (
    <div className="space-y-7">
      <TabHeader
        title="Maintenance"
        description="Problems reported on this vehicle, and the work orders that fix them."
        action={<TabAction ctx={ctx} actionKey="report-issue" />}
      />

      <section>
        <SubHead title="Work orders" count={active.length} description="Work in progress. Parts and labour are recorded as entries linked to the order." />
        {active.length === 0 ? (
          <EmptyState icon={<Wrench className="size-6" />} message="No work in progress. Plan one from a reported problem when something needs fixing." />
        ) : (
          <Card className="gap-0 py-0">
            <ul className="divide-y">
              {active.map((wo) => (
                <WoRow key={wo.id} ctx={ctx} wo={wo} />
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section>
        <SubHead title="New problems" count={unplanned.length} description="Reported, but not planned into a work order yet." />
        {unplanned.length === 0 ? (
          <EmptyState icon={<CircleCheck className="size-6" />} message="No new problems. Report one if something is wrong." className="py-8" />
        ) : (
          <Card className="gap-0 py-0">
            <ul className="divide-y">
              {unplanned.map((issue) => (
                <IssueRow key={issue.id} ctx={ctx} issue={issue} />
              ))}
            </ul>
          </Card>
        )}
      </section>

      {(doneWos.length > 0 || doneIssues.length > 0) && (
        <section>
          <button
            type="button"
            onClick={() => setShowDone((s) => !s)}
            aria-expanded={showDone}
            className="flex w-full items-center gap-2 rounded-md py-1 text-left text-sm font-semibold hover:text-foreground/80"
          >
            <ChevronRight className={cn("size-4 transition-transform", showDone && "rotate-90")} aria-hidden />
            Done
            <span className="font-normal text-muted-foreground">
              {plural(doneWos.length, "work order")}, {plural(doneIssues.length, "resolved problem")}
            </span>
          </button>
          {showDone && (
            <Card className="mt-3 gap-0 py-0">
              <ul className="divide-y">
                {doneWos.map((wo) => (
                  <WoRow key={wo.id} ctx={ctx} wo={wo} />
                ))}
                {doneIssues.map((issue) => (
                  <IssueRow key={issue.id} ctx={ctx} issue={issue} />
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}

function WoRow({ ctx, wo }: { ctx: Ctx; wo: WorkOrder }) {
  const rs = roleStepForWo(ctx.ws, wo, ctx.role);
  const active = isActiveWo(wo);
  const list = checklistOf(ctx, wo);
  const recorded = wo.costLines.reduce((s, c) => s + c.amountMinor, 0);
  const over = wo.actualCostMinor !== null && wo.expectedCostMinor !== null && wo.actualCostMinor > wo.expectedCostMinor;
  return (
    <RecordRow
      icon={<RowIcon icon={Wrench} tone={active && wo.safetyCritical ? "danger" : active ? "info" : "neutral"} />}
      title={wo.title}
      muted={!active}
      detail={
        <span className="flex flex-wrap items-center gap-x-1.5">
          <span className="tabular-nums">{wo.ref}</span>
          {wo.issueRef && (
            <>
              <Sep />
              <span>
                from <RefButton ctx={ctx} refId={wo.issueRef} className="font-normal text-muted-foreground" />
              </span>
            </>
          )}
          <Sep />
          <span>{shortName(wo.assignee)}</span>
          {active && list.length > 0 && (
            <>
              <Sep />
              <span>
                {list.filter((c) => c.done).length} of {list.length} steps done
              </span>
            </>
          )}
          {active && wo.safetyCritical && (
            <>
              <Sep />
              <SafetyMark />
            </>
          )}
        </span>
      }
      status={
        <span className="flex flex-col items-start gap-1">
          <WoStatus status={wo.status} />
          {rs.kind === "go" && !ctx.readOnly && <span className="text-xs font-medium text-foreground">Next step is yours</span>}
        </span>
      }
      aside={
        <>
          <div className={cn(!active && "text-muted-foreground")}>
            {wo.actualCostMinor !== null ? formatXaf(wo.actualCostMinor) : recorded > 0 ? `${formatXaf(recorded)} so far` : wo.expectedCostMinor !== null ? `${formatXaf(wo.expectedCostMinor)} planned` : "No estimate"}
            {over && wo.expectedCostMinor !== null && wo.actualCostMinor !== null && (
              <span className="ml-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                +{Math.round(((wo.actualCostMinor - wo.expectedCostMinor) / wo.expectedCostMinor) * 100)}%
              </span>
            )}
          </div>
          <div className={cn("text-xs", wo.dueBy && !wo.completedAt && daysFromToday(wo.dueBy) < 0 ? "font-medium text-destructive" : "text-muted-foreground")}>
            {wo.completedAt ? `Done ${shortDay(wo.completedAt)}` : wo.status === "CANCELLED" ? "Cancelled" : wo.dueBy ? `${shortDay(wo.dueBy)}, ${dueLabel(wo.dueBy)}` : "No due date"}
          </div>
        </>
      }
      menu={<RowMenu ctx={ctx} detail={{ kind: "work-order", ref: wo.ref }} label={wo.ref} steps={woMenu(ctx, wo)} />}
      onOpen={() => ctx.show({ kind: "work-order", ref: wo.ref })}
    />
  );
}

function IssueRow({ ctx, issue }: { ctx: Ctx; issue: Issue }) {
  const open = isOpenIssue(issue);
  const steps: MenuStep[] = open && !issue.workOrderRef && ctx.can("create-work-order") ? [{ step: { key: "create-work-order", label: "Create work order", ref: issue.ref } }] : [];
  return (
    <RecordRow
      icon={<RowIcon icon={issue.safetyCritical && open ? ShieldAlert : TriangleAlert} tone={!open ? "neutral" : issue.safetyCritical ? "danger" : "warning"} />}
      title={issue.title}
      muted={!open}
      detail={
        <span className="flex flex-wrap items-center gap-x-1.5">
          <span className="tabular-nums">{issue.ref}</span>
          <Sep />
          <span>{issue.category}</span>
          <Sep />
          <span>{issue.reportedBy}</span>
          {issue.photos > 0 && (
            <>
              <Sep />
              <span>{plural(issue.photos, "photo")}</span>
            </>
          )}
          {!open && issue.workOrderRef && (
            <>
              <Sep />
              <span>
                fixed in <RefButton ctx={ctx} refId={issue.workOrderRef} className="font-normal text-muted-foreground" />
              </span>
            </>
          )}
        </span>
      }
      status={
        open && !issue.workOrderRef ? (
          <StatusBadge tone="warning" icon={Clock} className="rounded-md">
            Not planned yet
          </StatusBadge>
        ) : (
          <StatusBadge tone="neutral" className="rounded-md">
            {ISSUE_STATUS_LABELS[issue.status]}
          </StatusBadge>
        )
      }
      aside={
        <>
          <div className={cn(!open && "text-muted-foreground")}>{shortDay(issue.reportedAt)}</div>
          <div className="text-xs text-muted-foreground">{open ? relativeDays(issue.reportedAt) : "reported"}</div>
        </>
      }
      menu={<RowMenu ctx={ctx} detail={{ kind: "issue", ref: issue.ref }} label={issue.ref} steps={steps} />}
      onOpen={() => ctx.show({ kind: "issue", ref: issue.ref })}
    />
  );
}

// ---------------------------------------------------------------------------
// Money

function MoneyTab({ ctx }: { ctx: Ctx }) {
  const { ws } = ctx;
  const m = ws.money;
  const [filter, setFilter] = useState("all");
  const test = ENTRY_FILTERS.find((f) => f.key === filter)?.test ?? (() => true);
  const entries = [...ws.entries].sort((a, b) => b.economicDate.localeCompare(a.economicDate));
  const shown = entries.filter(test);

  return (
    <div className="space-y-7">
      <TabHeader
        title={`Money · ${m.periodLabel}`}
        description="This vehicle's share of each entry. Awaiting review is never added to posted; posted is not paid."
        action={<TabAction ctx={ctx} actionKey="record-expense" />}
      />
      <PeriodStats ctx={ctx} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="gap-0 py-0">
          <CardHead title="Spending by category" description={`Posted, ${m.periodLabel}`} />
          <CategoryBars ctx={ctx} />
        </Card>
        <Card className="gap-0 py-0">
          <CardHead title="Last 6 months" description="Posted entries by month" />
          <MonthlyBars ctx={ctx} />
        </Card>
      </div>

      <section>
        <SubHead title="Entries" count={ws.entries.length} description="Nothing is edited: a correction is a reversal, and both stay listed." />
        <div className="mb-3">
          <FilterChips options={ENTRY_FILTERS.map((f) => ({ key: f.key, label: f.label, count: ws.entries.filter(f.test).length }))} value={filter} onChange={setFilter} />
        </div>
        {shown.length === 0 ? (
          <EmptyState icon={<Receipt className="size-6" />} message="No entries match this filter. Choose All to see every entry." />
        ) : (
          <Card className="gap-0 py-0">
            <ul className="divide-y">
              {shown.map((e) => (
                <EntryRow key={e.id} ctx={ctx} entry={e} />
              ))}
            </ul>
          </Card>
        )}
      </section>

      <p className="border-t pt-4 text-xs text-muted-foreground">
        Lifetime, all posted entries since registration: revenue <span className="font-medium text-foreground tabular-nums">{formatXaf(m.lifetime.revenueMinor)}</span>
        {" · "}expenses <span className="font-medium text-foreground tabular-nums">{formatXaf(m.lifetime.expenseMinor)}</span>
        {" · "}net <span className="font-medium text-foreground tabular-nums">{formatXaf(m.lifetime.netMinor, { signed: true })}</span>. Recorded figures, not cash
        paid or profit.
      </p>
    </div>
  );
}

function Stat({ label, value, hint, warn = false, info }: { label: string; value: string; hint: ReactNode; warn?: boolean; info?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-card p-3 ring-1 ring-foreground/10 sm:p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {warn && <TriangleAlert className="size-3.5 text-amber-600 dark:text-amber-400" aria-hidden />}
        {label}
        {info && (
          <Tooltip>
            <TooltipTrigger className="ml-auto inline-flex rounded-sm text-muted-foreground hover:text-foreground" aria-label="How this is calculated">
              <Info className="size-3.5" aria-hidden />
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{info}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="text-lg font-semibold leading-tight tabular-nums sm:text-xl">{value}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function PeriodStats({ ctx }: { ctx: Ctx }) {
  const m = ctx.ws.money;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Posted expenses" value={formatXaf(m.postedExpenseMinor)} hint="All layers · posted is not paid" />
      <Stat label="Awaiting review" value={formatXaf(m.pendingReviewMinor)} hint={`${plural(m.pendingReviewCount, "entry", "entries")} · not in posted`} warn={m.pendingReviewCount > 0} />
      <Stat label="Missing receipts" value={plural(m.missingEvidenceCount, "entry", "entries")} hint="Recorded without proof" warn={m.missingEvidenceCount > 0} />
      {m.costPerKm ? (
        <Stat label="Cost per km" value={`${m.costPerKm.minor.toLocaleString("en-US")} XAF/km`} hint={`Over ${km(ctx.ws.meter.km30d)} between readings`} info={m.costPerKm.basis} />
      ) : (
        <Stat label="Cost per km" value="Not enough data" hint="Needs start and end readings" />
      )}
    </div>
  );
}

function CategoryBars({ ctx }: { ctx: Ctx }) {
  const cats = ctx.ws.money.byCategory;
  const total = cats.reduce((s, c) => s + c.minor, 0);
  const max = Math.max(1, ...cats.map((c) => c.minor));
  if (cats.length === 0) return <p className="px-4 py-6 text-sm text-muted-foreground">No posted expenses this month yet.</p>;
  return (
    <div className="space-y-4 p-4">
      <ul className="space-y-3.5">
        {cats.map((c) => (
          <li key={c.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="font-medium">{c.label}</span>
                <span className="text-xs text-muted-foreground">{LAYER_LABELS[c.layer]}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                {formatXaf(c.minor)}
                <span className="ml-2 inline-block w-9 text-right text-xs text-muted-foreground">{Math.round((c.minor / Math.max(1, total)) * 100)}%</span>
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-sm bg-muted">
              <div className="h-full rounded-sm bg-foreground/70" style={{ width: `${(c.minor / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="flex justify-between border-t pt-3 text-sm">
        <span className="text-muted-foreground">Total posted</span>
        <span className="font-semibold tabular-nums">{formatXaf(total)}</span>
      </p>
    </div>
  );
}

function MonthlyBars({ ctx }: { ctx: Ctx }) {
  const months = ctx.ws.money.monthly;
  const [sel, setSel] = useState(months.length - 1);
  const max = Math.max(1, ...months.flatMap((m) => [m.expenseMinor, m.revenueMinor]));
  const current = months[sel];
  const height = (v: number) => `${Math.max(2, Math.round((v / max) * 132))}px`;
  return (
    <div className="p-4">
      <div className="flex h-44 items-end gap-1.5 sm:gap-2" role="list">
        {months.map((m, i) => (
          <button
            key={m.month}
            type="button"
            role="listitem"
            onMouseEnter={() => setSel(i)}
            onFocus={() => setSel(i)}
            onClick={() => setSel(i)}
            aria-label={`${monthLabel(m.month)}: expenses ${formatXaf(m.expenseMinor)}, revenue ${formatXaf(m.revenueMinor)}`}
            className={cn("flex h-full flex-1 flex-col justify-end gap-1.5 rounded-md px-1 pt-2 pb-1.5 transition-colors", i === sel ? "bg-muted" : "hover:bg-muted/50")}
          >
            <span className="flex items-end justify-center gap-1">
              <span className="w-3 rounded-t-[3px] bg-foreground/75 sm:w-4" style={{ height: height(m.expenseMinor) }} />
              <span className="w-3 rounded-t-[3px] bg-foreground/20 sm:w-4" style={{ height: height(m.revenueMinor) }} />
            </span>
            <span className={cn("text-xs", i === sel ? "font-medium text-foreground" : "text-muted-foreground")}>{m.label}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-2 border-t pt-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="font-medium">{current ? monthLabel(current.month) : ""}</span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px] bg-foreground/75" aria-hidden />
            Expenses <span className="font-medium text-foreground tabular-nums">{current ? formatXaf(current.expenseMinor) : ""}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px] bg-foreground/20" aria-hidden />
            Revenue <span className="font-medium text-foreground tabular-nums">{current ? formatXaf(current.revenueMinor) : ""}</span>
          </span>
        </span>
      </div>
    </div>
  );
}

function EntryAmount({ entry }: { entry: MoneyEntry }) {
  const split = entry.amountMinor !== entry.entryTotalMinor;
  return (
    <>
      <div className={cn("font-medium", entry.status === "REVERSED" && "text-muted-foreground line-through")}>
        {formatXaf(entry.amountMinor, { signed: entry.direction === "REVENUE" })}
      </div>
      {split && <div className="text-xs text-muted-foreground">of {formatXaf(entry.entryTotalMinor)} entry</div>}
    </>
  );
}

function EntryLink({ ctx, entry }: { ctx: Ctx; entry: MoneyEntry }) {
  if (!entry.link) return <span className="text-muted-foreground">Not linked</span>;
  return <RefButton ctx={ctx} refId={entry.link.ref} hint={entry.link.kind === "TRIP" ? "trip" : undefined} className="font-normal text-muted-foreground" />;
}

function EntryRow({ ctx, entry: e }: { ctx: Ctx; entry: MoneyEntry }) {
  const revenue = e.direction === "REVENUE";
  return (
    <RecordRow
      icon={<RowIcon icon={revenue ? CircleDollarSign : Receipt} tone={revenue ? "success" : "neutral"} />}
      title={
        <>
          {e.category}
          {e.counterparty && <span className="font-normal text-muted-foreground"> · {e.counterparty}</span>}
        </>
      }
      detail={
        <span className="flex flex-wrap items-center gap-x-1.5">
          <span className="tabular-nums">{e.number}</span>
          <Sep />
          <span>{shortDay(e.economicDate)}</span>
          <Sep />
          <span>{LAYER_LABELS[e.layer]}</span>
          {e.link && (
            <>
              <Sep />
              <span>
                for <EntryLink ctx={ctx} entry={e} />
              </span>
            </>
          )}
        </span>
      }
      status={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 md:flex-col md:items-start">
          <EntryStatusBadge status={e.status} />
          {e.evidence === "MISSING" && <Evidence state="MISSING" />}
        </span>
      }
      aside={<EntryAmount entry={e} />}
      menu={<RowMenu ctx={ctx} detail={{ kind: "entry", number: e.number }} label={e.number} steps={entryActions(e).filter((s) => ctx.can(s.key)).map((step) => ({ step }))} />}
      onOpen={() => ctx.show({ kind: "entry", number: e.number })}
    />
  );
}

// ---------------------------------------------------------------------------
// Trips

function TripsTab({ ctx }: { ctx: Ctx }) {
  const { ws } = ctx;
  const trips = ws.trips;
  const totalKm = trips.reduce((s, t) => s + (t.distanceKm ?? 0), 0);
  return (
    <section>
      <TabHeader
        title="Trips"
        description={trips.length > 0 ? `Trips with this vehicle as the main vehicle · ${km(totalKm)} recorded` : "Trips with this vehicle as the main vehicle"}
        action={<TabAction ctx={ctx} actionKey="start-trip" />}
      />
      {trips.length === 0 ? (
        <EmptyState icon={<Route className="size-6" />} message="No trips yet. Start one when the vehicle leaves the depot." />
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y">
            {trips.map((t) => (
              <RecordRow
                key={t.id}
                icon={<RowIcon icon={Route} tone={t.status === "OPEN" ? "info" : "neutral"} />}
                title={`${t.from} → ${t.to}`}
                detail={
                  <span className="flex flex-wrap items-center gap-x-1.5">
                    <span className="tabular-nums">{t.number}</span>
                    <Sep />
                    <span>{t.customer ?? t.type}</span>
                    <Sep />
                    <span>{t.driver}</span>
                    <Sep />
                    <span>
                      {shortDay(t.startedAt)}
                      {t.endedAt ? `–${shortDay(t.endedAt)}` : ", still open"}
                    </span>
                    {t.distanceKm !== null && (
                      <>
                        <Sep />
                        <span className="tabular-nums">{km(t.distanceKm)}</span>
                      </>
                    )}
                  </span>
                }
                status={<TripState trip={t} />}
                aside={
                  <>
                    <div>{t.revenueMinor !== null ? formatXaf(t.revenueMinor, { signed: true }) : <span className="text-muted-foreground">No revenue</span>}</div>
                    <div className="text-xs text-muted-foreground">{formatXaf(t.costMinor)} costs</div>
                  </>
                }
                menu={<RowMenu ctx={ctx} detail={{ kind: "trip", number: t.number }} label={`trip ${t.number}`} steps={tripActions(t).filter((s) => ctx.can(s.key)).map((step) => ({ step }))} />}
                onOpen={() => ctx.show({ kind: "trip", number: t.number })}
              />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Documents

function DocumentsTab({ ctx }: { ctx: Ctx }) {
  const docs = ctx.ws.documents;
  return (
    <section>
      <TabHeader title="Documents" description="Expiry dates drive reminders. Renewing keeps every earlier version." action={<TabAction ctx={ctx} actionKey="add-document" />} />
      {docs.length === 0 ? (
        <EmptyState icon={<FileText className="size-6" />} message="No documents yet. Add the insurance and the inspection so expiry reminders work." />
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y">
            {docs.map((d) => (
              <RecordRow
                key={d.id}
                icon={<RowIcon icon={FileText} tone={d.state === "EXPIRED" ? "danger" : d.state === "EXPIRING" ? "warning" : "neutral"} />}
                title={d.type}
                detail={
                  <span className="flex flex-wrap items-center gap-x-1.5">
                    <span className="tabular-nums">{d.number ?? "No number"}</span>
                    <Sep />
                    <span>{d.previousVersions > 0 ? `${plural(d.previousVersions, "earlier version")} kept` : "First version"}</span>
                    <Sep />
                    {d.hasFile ? <span>Scan on file</span> : <span className="font-medium text-amber-700 dark:text-amber-400">No scan on file</span>}
                  </span>
                }
                status={<DocState doc={d} />}
                aside={
                  d.expiresAt ? (
                    <>
                      <div className={cn(d.state === "EXPIRED" && "font-medium text-destructive")}>{formatDate(d.expiresAt)}</div>
                      <div className="text-xs text-muted-foreground">{d.state === "EXPIRED" ? relativeDays(d.expiresAt) : "valid until"}</div>
                    </>
                  ) : (
                    <div className="text-muted-foreground">No expiry</div>
                  )
                }
                menu={<RowMenu ctx={ctx} detail={{ kind: "document", id: d.id }} label={docName(d)} steps={docActions(d).filter((s) => ctx.can(s.key)).map((step) => ({ step }))} />}
                onOpen={() => ctx.show({ kind: "document", id: d.id })}
              />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// History

function HistoryTab({ ctx }: { ctx: Ctx }) {
  const { ws } = ctx;
  const [filter, setFilter] = useState("all");
  const kinds = HISTORY_FILTERS.find((f) => f.key === filter)?.kinds ?? null;
  const events = [...ws.timeline].sort((a, b) => b.at.localeCompare(a.at)).filter((e) => kinds === null || kinds.includes(e.kind));
  const groups: Array<{ key: string; events: TimelineEvent[] }> = [];
  for (const e of events) {
    const key = dayKey(e.at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push(e);
    else groups.push({ key, events: [e] });
  }
  const options = HISTORY_FILTERS.map((f) => ({ key: f.key, label: f.label, count: f.kinds === null ? ws.timeline.length : ws.timeline.filter((e) => f.kinds?.includes(e.kind)).length }));

  return (
    <section className="space-y-5">
      <TabHeader title="History" description="Everything recorded on this vehicle. Nothing is edited away: corrections appear as reversals next to the original." />
      <FilterChips options={options} value={filter} onChange={setFilter} />
      {groups.length === 0 ? (
        <EmptyState icon={<Clock className="size-6" />} message="Nothing of this kind recorded yet. Choose All to see everything." />
      ) : (
        groups.map((g) => {
          const rel = relativeDays(g.key);
          const label = toDate(g.key).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
          return (
            <div key={g.key}>
              <h3 className="mb-2 flex items-baseline gap-2 text-xs font-medium text-muted-foreground">
                <span className="text-foreground">{label}</span>
                {(rel === "today" || rel === "yesterday") && <span>{rel}</span>}
              </h3>
              <Card className="gap-0 py-0">
                <ol className="divide-y">
                  {g.events.map((e) => (
                    <EventRow key={e.id} ctx={ctx} event={e} />
                  ))}
                </ol>
              </Card>
            </div>
          );
        })
      )}
    </section>
  );
}

function EventRow({ ctx, event }: { ctx: Ctx; event: TimelineEvent }) {
  const Icon = KIND_ICON[event.kind];
  const hint = REF_HINT[event.kind];
  const signed = event.kind === "REVERSAL" || event.kind === "REVENUE";
  return (
    <li className="flex gap-3 px-4 py-3">
      <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-md", EVENT_TONE_CLASS[event.tone])}>
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="font-medium leading-snug">{event.title}</p>
          {event.amountMinor !== null && (
            <span className={cn("shrink-0 text-sm tabular-nums", event.amountMinor < 0 && "text-muted-foreground")}>{formatXaf(event.amountMinor, { signed })}</span>
          )}
        </div>
        {event.detail && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            <LinkedText ctx={ctx} text={event.detail} refId={event.ref} hint={hint} />
          </p>
        )}
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          <span>{event.actor}</span>
          <Sep />
          <time dateTime={event.at}>{timeOf(event.at)}</time>
          {event.ref && !refInText(ctx.ws, event.detail, event.ref, hint) && (
            <>
              <Sep />
              <RefButton ctx={ctx} refId={event.ref} hint={hint} />
            </>
          )}
        </p>
      </div>
    </li>
  );
}

/** The text a ref shows as, if the event detail already names it. */
function refToken(ws: VehicleWorkspace, text: string | null, ref: string, hint?: RefHint): string | null {
  if (!text) return null;
  if (text.includes(ref)) return ref;
  const detail = resolveRef(ws, ref, hint);
  const label = detail?.kind === "document" ? detailLabel(ws, detail) : null;
  return label && text.includes(label) ? label : null;
}

function refInText(ws: VehicleWorkspace, text: string | null, ref: string, hint?: RefHint): boolean {
  return resolveRef(ws, ref, hint) !== null && refToken(ws, text, ref, hint) !== null;
}

function LinkedText({ ctx, text, refId, hint }: { ctx: Ctx; text: string; refId: string | null; hint: RefHint | undefined }) {
  const detail = refId ? resolveRef(ctx.ws, refId, hint) : null;
  const token = refId && detail ? refToken(ctx.ws, text, refId, hint) : null;
  if (!detail || !token) return <>{text}</>;
  const at = text.indexOf(token);
  return (
    <>
      {text.slice(0, at)}
      <LinkButton onClick={() => ctx.show(detail)}>{token}</LinkButton>
      {text.slice(at + token.length)}
    </>
  );
}

// ---------------------------------------------------------------------------
// Phone bottom bar and the all-actions sheet

function BottomBar({ ctx }: { ctx: Ctx }) {
  if (ctx.readOnly) return null;
  const keys = BAR_PLAN[ctx.role].filter((k) => ctx.can(k) && globalLock(ctx.ws, k) === null).slice(0, 3);
  return (
    <nav
      aria-label="Quick actions"
      className="fixed inset-x-3 bottom-20 z-40 grid grid-cols-4 gap-1 rounded-xl border bg-background/95 p-1 shadow-lg backdrop-blur supports-backdrop-filter:bg-background/85 md:hidden"
    >
      {keys.map((k) => {
        const a = actionByKey(k);
        return (
          <button
            key={k}
            type="button"
            onClick={() => ctx.act(k, contextRef(ctx.ws, k))}
            className="flex h-14 flex-col items-center justify-center gap-1 rounded-lg text-xs font-medium transition-colors hover:bg-muted active:bg-muted"
          >
            <a.icon className="size-5" aria-hidden />
            {a.short}
          </button>
        );
      })}
      <button
        type="button"
        onClick={ctx.openAll}
        className="col-start-4 flex h-14 flex-col items-center justify-center gap-1 rounded-lg text-xs font-medium text-muted-foreground transition-colors hover:bg-muted active:bg-muted"
      >
        <LayoutGrid className="size-5" aria-hidden />
        More
      </button>
    </nav>
  );
}

function AllActionsSheet({
  ctx,
  open,
  onOpenChange,
  byGroup,
}: {
  ctx: Ctx;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  byGroup: ReturnType<typeof useVehicleActions>["byGroup"];
}) {
  const isMobile = useIsMobile();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [query, setQuery] = useState("");
  const first = GROUP_FIRST[ctx.role];
  const ordered = first ? [...byGroup].sort((a, b) => Number(b.group === first) - Number(a.group === first)) : byGroup;
  const q = query.trim().toLowerCase();
  const groups = ordered
    .map((g) => ({ group: g.group, actions: g.actions.filter((a) => !q || `${a.label} ${a.description} ${g.group}`.toLowerCase().includes(q)) }))
    .filter((g) => g.actions.length > 0);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setQuery("");
      }}
    >
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        initialFocus={isMobile ? titleRef : true}
        className={cn("gap-0", isMobile ? "max-h-[88vh] rounded-t-xl" : "data-[side=right]:sm:max-w-md")}
      >
        <SheetHeader className="gap-1 border-b pr-12">
          <SheetTitle ref={titleRef} tabIndex={-1} className="text-base font-semibold outline-none">
            All actions
          </SheetTitle>
          <SheetDescription>Everything you can do on {ctx.ws.vehicle.code}, by area.</SheetDescription>
          <div className="relative mt-2.5">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search, e.g. fuel, renew, sign off" className="h-9 pl-8" aria-label="Search actions" />
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-4">
          {groups.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              No action matches “{query}”. Try “fuel”, “problem” or “renew”.
            </p>
          ) : (
            groups.map((g) => (
              <section key={g.group} className="pt-2">
                <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">{g.group}</h3>
                <ul>
                  {g.actions.map((a) => {
                    const lock = globalLock(ctx.ws, a.key);
                    return (
                      <li key={a.key}>
                        <button
                          type="button"
                          disabled={lock !== null}
                          onClick={() => ctx.act(a.key, contextRef(ctx.ws, a.key))}
                          className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:hover:bg-transparent"
                        >
                          <span className={cn("grid size-8 shrink-0 place-items-center rounded-md bg-muted", lock ? "text-muted-foreground" : "text-foreground/80")}>
                            <a.icon className="size-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={cn("flex items-center gap-1.5 text-sm font-medium", lock && "text-muted-foreground")}>
                              {a.label}
                              {lock && <Lock className="size-3" aria-label="Not available yet" />}
                            </span>
                            <span className="block text-xs leading-snug text-muted-foreground">{lock ? `${lock}.` : shortDescription(a)}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Record panel: one overlay; a record's forms open inside it with a way back

function RecordPanel({ ctx, stack, setStack }: { ctx: Ctx; stack: Page[]; setStack: (update: (s: Page[]) => Page[]) => void }) {
  const isMobile = useIsMobile();
  const page = stack.length > 0 ? stack[stack.length - 1] : undefined;
  const previous = stack.length > 1 ? stack[stack.length - 2] : undefined;
  const back = () => setStack((s) => s.slice(0, -1));
  const push = (step: Step) => setStack((s) => [...s, { kind: "form", key: step.key, ref: step.ref }]);
  return (
    <Sheet open={page !== undefined} onOpenChange={(open) => !open && setStack(() => [])}>
      <SheetContent side={isMobile ? "bottom" : "right"} className={cn("gap-0 overflow-y-auto", isMobile ? "max-h-[92vh] rounded-t-xl" : "data-[side=right]:sm:max-w-lg")}>
        {page?.kind === "record" && (
          <>
            {previous && (
              <button type="button" onClick={back} className="flex items-center gap-1 self-start px-4 pt-3 text-xs font-medium text-muted-foreground hover:text-foreground">
                <ArrowLeft className="size-3.5" aria-hidden />
                Back to {previous.kind === "record" ? detailLabel(ctx.ws, previous.detail) : actionByKey(previous.key).label}
              </button>
            )}
            <RecordBody ctx={ctx} detail={page.detail} onAct={push} />
          </>
        )}
        {page?.kind === "form" && (
          <FormPage ctx={ctx} actionKey={page.key} refId={page.ref} context={previous?.kind === "record" ? previous.detail : null} onBack={back} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function FormPage({ ctx, actionKey, refId, context, onBack }: { ctx: Ctx; actionKey: ActionKey; refId: string | null; context: Detail | null; onBack: () => void }) {
  const a = actionByKey(actionKey);
  const fields = a.fields(ctx.ws, prefill(ctx.ws, actionKey, refId));
  return (
    <>
      <div className="border-b px-4 pt-3 pb-4 pr-12">
        {context && (
          <button
            type="button"
            onClick={onBack}
            className="mb-3 flex max-w-full items-center gap-1.5 rounded-md py-0.5 text-left text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ArrowLeft className="size-4 shrink-0" aria-hidden />
            <span className="truncate font-medium text-foreground/80">{recordTitle(ctx.ws, context)}</span>
          </button>
        )}
        <SheetTitle className="flex items-center gap-2 text-lg leading-snug font-semibold">
          <a.icon className="size-4" aria-hidden />
          {a.label}
        </SheetTitle>
        <SheetDescription className="mt-1">{a.description}</SheetDescription>
        <StatusNote status={a.status} command={a.command} />
      </div>
      <div className="grid gap-4 p-4">
        {fields.map((f) => (
          <FieldPreview key={f.label} field={f} />
        ))}
      </div>
      <SheetFooter className="sticky bottom-0 z-20 flex-row gap-2 border-t bg-popover">
        <Button
          className="h-10 flex-1 sm:h-9 sm:flex-none"
          onClick={() => {
            toast.add({ type: "success", title: "Prototype", description: `${a.label}: nothing was submitted.` });
            onBack();
          }}
        >
          {a.primary}
        </Button>
        <Button variant="outline" className="h-10 sm:h-9" onClick={onBack}>
          Cancel
        </Button>
      </SheetFooter>
    </>
  );
}

function FieldPreview({ field }: { field: Field }) {
  const id = `proto-e-${field.label.replace(/\W+/g, "-").toLowerCase()}`;
  if (field.type === "pinned") {
    return (
      <div className="grid gap-1">
        <span className="text-xs font-medium text-muted-foreground">{field.label}</span>
        <p className="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-line">{field.value}</p>
      </div>
    );
  }
  if (field.type === "toggle") {
    return (
      <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-current" />
        <span>
          <span className="font-medium">{field.label}</span>
          {field.hint && <span className="block text-xs text-muted-foreground">{field.hint}</span>}
        </span>
      </label>
    );
  }
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{field.label}</Label>
      {field.type === "textarea" ? (
        <Textarea id={id} defaultValue={field.value} rows={3} />
      ) : field.type === "select" ? (
        <select id={id} defaultValue={field.value} className="h-9 rounded-md border bg-background px-3 text-sm">
          {(field.options ?? []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : field.type === "file" ? (
        <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">Add a photo or document</div>
      ) : (
        <Input
          id={id}
          defaultValue={field.value}
          inputMode={field.type === "money" || field.type === "number" ? "numeric" : undefined}
          type={field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : "text"}
          placeholder={field.type === "money" ? "0 XAF" : undefined}
        />
      )}
      {field.hint && <span className="text-xs text-muted-foreground">{field.hint}</span>}
    </div>
  );
}

function RecordBody({ ctx, detail, onAct }: { ctx: Ctx; detail: Detail; onAct: (step: Step) => void }) {
  const { ws } = ctx;
  switch (detail.kind) {
    case "work-order": {
      const wo = ws.workOrders.find((w) => w.ref === detail.ref);
      return wo ? <WorkOrderDetail ctx={ctx} wo={wo} onAct={onAct} /> : <Missing />;
    }
    case "issue": {
      const issue = ws.issues.find((i) => i.ref === detail.ref);
      return issue ? <IssueDetail ctx={ctx} issue={issue} onAct={onAct} /> : <Missing />;
    }
    case "entry": {
      const entry = ws.entries.find((e) => e.number === detail.number);
      return entry ? <EntryDetail ctx={ctx} entry={entry} onAct={onAct} /> : <Missing />;
    }
    case "trip": {
      const trip = ws.trips.find((t) => t.number === detail.number);
      return trip ? <TripDetail ctx={ctx} trip={trip} onAct={onAct} /> : <Missing />;
    }
    case "document": {
      const doc = ws.documents.find((d) => d.id === detail.id);
      return doc ? <DocumentDetail ctx={ctx} doc={doc} onAct={onAct} /> : <Missing />;
    }
    case "readings":
      return <ReadingsDetail ctx={ctx} onAct={onAct} />;
  }
}

function Missing() {
  return (
    <div className="p-4">
      <SheetTitle>Not found</SheetTitle>
      <SheetDescription>This record is not part of the sample data.</SheetDescription>
    </div>
  );
}

function DetailHeader({ eyebrow, title, meta, description }: { eyebrow: ReactNode; title: ReactNode; meta?: ReactNode; description?: ReactNode }) {
  return (
    <div className="border-b px-4 pt-4 pb-4 pr-12">
      <p className="text-xs font-medium text-muted-foreground tabular-nums">{eyebrow}</p>
      <SheetTitle className="mt-1 text-lg leading-snug font-semibold">{title}</SheetTitle>
      {description && <SheetDescription className="mt-1">{description}</SheetDescription>}
      {meta && <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">{meta}</div>}
    </div>
  );
}

function DetailSection({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function FactList({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 font-medium">{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Note({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "danger" }) {
  return (
    <p className={cn("flex gap-2 rounded-lg px-3 py-2.5 text-sm", tone === "danger" ? "bg-destructive/5 text-destructive dark:bg-destructive/10" : "bg-muted/60 text-muted-foreground")}>
      {tone === "danger" ? <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <span>{children}</span>
    </p>
  );
}

/**
 * The footer holds this record's actions only; a locked step says what it waits for.
 * Only this role's own next step is solid; `primary: null` keeps every button quiet.
 */
function PanelFooter({
  ctx,
  steps,
  primary,
  locked,
  waiting,
  onAct,
}: {
  ctx: Ctx;
  steps: Step[];
  primary?: ActionKey | null;
  locked?: Locked | null;
  waiting?: string | null;
  onAct: (step: Step) => void;
}) {
  const permitted = steps.filter((s) => ctx.can(s.key));
  const solidKey = primary === undefined ? permitted[0]?.key : primary;
  const allowed = [...permitted].sort((a, b) => Number(b.key === solidKey) - Number(a.key === solidKey));
  const lock = locked && ctx.can(locked.step.key) ? locked : null;
  const note = !lock && waiting ? waiting : null;
  if (allowed.length === 0 && !lock && !note) return null;
  return (
    <SheetFooter className="sticky bottom-0 z-20 gap-3 border-t bg-popover">
      {note && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Hourglass className="mt-0.5 size-4 shrink-0" aria-hidden />
          {note}
        </p>
      )}
      {lock && (
        <div className="flex items-center gap-3">
          <Button variant="outline" disabled className="h-9 shrink-0">
            <Lock aria-hidden />
            {lock.step.label}
          </Button>
          <p className="text-xs leading-snug text-muted-foreground">{lock.reason}.</p>
        </div>
      )}
      {allowed.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {allowed.map((s, i) => {
            const Icon = actionByKey(s.key).icon;
            return (
              <Button
                key={s.key}
                variant={s.key === solidKey ? "default" : "outline"}
                className={cn("h-10 sm:h-9", i === 0 && allowed.length > 2 ? "basis-full sm:basis-auto" : "flex-1 sm:flex-none")}
                onClick={() => onAct(s)}
              >
                <Icon aria-hidden />
                {s.label}
              </Button>
            );
          })}
        </div>
      )}
    </SheetFooter>
  );
}

function Chronology({ ctx, events, currentRef }: { ctx: Ctx; events: TimelineEvent[]; currentRef: string }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>;
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <ol className="relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[13px] before:w-px before:bg-border">
      {sorted.map((e) => {
        const Icon = KIND_ICON[e.kind];
        return (
          <li key={e.id} className="relative flex gap-3">
            <span className={cn("z-10 grid size-7 shrink-0 place-items-center rounded-md ring-4 ring-popover", EVENT_TONE_CLASS[e.tone])}>
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm font-medium leading-snug">{e.title}</p>
              <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <span>{e.actor}</span>
                <Sep />
                <span>{formatDateTime(e.at)}</span>
                {e.amountMinor !== null && (
                  <>
                    <Sep />
                    <span className="tabular-nums">{formatXaf(e.amountMinor, { signed: e.kind === "REVERSAL" })}</span>
                  </>
                )}
                {e.ref && e.ref !== currentRef && (
                  <>
                    <Sep />
                    <RefButton ctx={ctx} refId={e.ref} hint={REF_HINT[e.kind]} className="font-normal" />
                  </>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function WorkOrderDetail({ ctx, wo, onAct }: { ctx: Ctx; wo: WorkOrder; onAct: (step: Step) => void }) {
  const { ws } = ctx;
  const issue = wo.issueRef ? ws.issues.find((i) => i.ref === wo.issueRef) : undefined;
  const grounding = isGroundingWo(ws, wo);
  const checklist = checklistOf(ctx, wo);
  const doneCount = checklist.filter((c) => c.done).length;
  const canTick = wo.status === "OPEN" && ctx.can("complete-work-order");
  const recorded = wo.costLines.reduce((s, c) => s + c.amountMinor, 0);
  const entryNumbers = wo.costLines.map((c) => c.entryNumber).filter((n): n is string => n !== null);
  const chronology = ws.timeline.filter((e) => e.ref !== null && (e.ref === wo.ref || e.ref === wo.issueRef || entryNumbers.includes(e.ref)));
  const menu = woMenu(ctx, wo);
  const rs = roleStepForWo(ws, wo, ctx.role);
  const steps = menu.filter((m) => !m.locked).map((m) => m.step);

  return (
    <>
      <DetailHeader
        eyebrow={`Work order ${wo.ref}`}
        title={wo.title}
        meta={
          <>
            <WoStatus status={wo.status} />
            {wo.safetyCritical && <SafetyMark />}
          </>
        }
      />
      <div className="space-y-6 p-4">
        {issue && (
          <button
            type="button"
            onClick={() => ctx.show({ kind: "issue", ref: issue.ref })}
            className="flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
          >
            <TriangleAlert className={cn("mt-0.5 size-4 shrink-0", issue.safetyCritical ? "text-destructive" : "text-amber-600 dark:text-amber-400")} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-muted-foreground">From problem {issue.ref}</span>
              <span className="block text-sm font-medium">{issue.title}</span>
            </span>
            <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        )}
        {grounding && <Note tone="danger">This work order keeps the vehicle grounded. After sign-off, a manager releases it to service.</Note>}

        <FactList
          rows={[
            ["Assigned to", wo.assignee],
            ["Opened", `${formatDateTime(wo.createdAt)} by ${wo.createdBy}`],
            ["Due", wo.dueBy ? `${formatDate(wo.dueBy)}${wo.completedAt ? "" : `, ${dueLabel(wo.dueBy)}`}` : "No due date"],
            ["Expected cost", wo.expectedCostMinor !== null ? formatXaf(wo.expectedCostMinor) : "No estimate"],
            ["Actual cost", wo.actualCostMinor !== null ? formatXaf(wo.actualCostMinor) : "Set when the work is completed"],
            ...(wo.completedAt ? ([["Completed", `${formatDateTime(wo.completedAt)} by ${wo.completedBy ?? "unknown"}`]] as Array<[string, ReactNode]>) : []),
          ]}
        />

        {wo.summary && (
          <DetailSection title={wo.status === "CANCELLED" ? "Reason" : "What was done"}>
            <p className="text-sm">{wo.summary}</p>
          </DetailSection>
        )}

        <DetailSection title="Checklist" aside={checklist.length > 0 ? `${doneCount} of ${checklist.length} done` : undefined}>
          {checklist.length === 0 ? (
            <p className="text-sm text-muted-foreground">No checklist on this work order.</p>
          ) : (
            <>
              <div className="h-1.5 overflow-hidden rounded-sm bg-muted">
                <div className="h-full bg-success transition-[width]" style={{ width: `${(doneCount / checklist.length) * 100}%` }} />
              </div>
              <ul className="-mx-2">
                {checklist.map((c, i) => (
                  <li key={c.label}>
                    {canTick ? (
                      <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                        <Checkbox checked={c.done} onCheckedChange={(checked) => ctx.tick(wo.ref, i, checked)} className="mt-0.5" />
                        <span className={cn(c.done && "text-muted-foreground line-through decoration-foreground/20")}>{c.label}</span>
                      </label>
                    ) : (
                      <div className="flex items-start gap-2.5 px-2 py-1.5 text-sm">
                        {c.done ? (
                          <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-foreground" aria-label="Done" />
                        ) : (
                          <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Not done" />
                        )}
                        <span className={cn(c.done && "text-muted-foreground")}>{c.label}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {canTick && <p className="text-xs text-muted-foreground">Tick steps as you finish them. Complete the work when every step is done.</p>}
            </>
          )}
        </DetailSection>

        <DetailSection title="Costs" aside={wo.costLines.length > 0 ? `${formatXaf(recorded)} so far` : undefined}>
          {wo.costLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No costs recorded against this work order yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {wo.costLines.map((line) => (
                <li key={line.label} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{line.label}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                      <span>{line.kind}</span>
                      <Sep />
                      {line.entryNumber ? (
                        <>
                          <RefButton ctx={ctx} refId={line.entryNumber} hint="entry" className="font-normal" />
                          {line.entryStatus && <span>({ENTRY_STATUS_LABELS[line.entryStatus].toLowerCase()})</span>}
                        </>
                      ) : (
                        <span>Not recorded as an entry yet</span>
                      )}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums">{formatXaf(line.amountMinor)}</span>
                </li>
              ))}
              {wo.expectedCostMinor !== null && (
                <li className="flex justify-between gap-3 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <span>Expected</span>
                  <span className="tabular-nums">{formatXaf(wo.expectedCostMinor)}</span>
                </li>
              )}
            </ul>
          )}
        </DetailSection>

        <DetailSection title="Chronology">
          <Chronology ctx={ctx} events={chronology} currentRef={wo.ref} />
        </DetailSection>
      </div>
      <PanelFooter
        ctx={ctx}
        steps={steps}
        primary={rs.kind === "go" ? rs.step.key : null}
        locked={rs.kind === "locked" ? { step: rs.step, reason: rs.reason } : null}
        waiting={rs.kind === "go" ? null : ctx.readOnly || steps.length === 0 || FLOW_ROLE[ctx.role] === "none" ? woWaiting(ws, wo) : null}
        onAct={onAct}
      />
    </>
  );
}

function IssueDetail({ ctx, issue, onAct }: { ctx: Ctx; issue: Issue; onAct: (step: Step) => void }) {
  const events = ctx.ws.timeline.filter((e) => e.ref === issue.ref);
  const unplanned = issue.status === "OPEN" && !issue.workOrderRef;
  return (
    <>
      <DetailHeader
        eyebrow={`Problem ${issue.ref}`}
        title={issue.title}
        meta={
          <>
            {unplanned ? (
              <StatusBadge tone="warning" icon={Clock} className="rounded-md">
                Not planned yet
              </StatusBadge>
            ) : (
              <StatusBadge tone={issue.status === "IN_WORK" ? "info" : "neutral"} className="rounded-md">
                {ISSUE_STATUS_LABELS[issue.status]}
              </StatusBadge>
            )}
            {issue.safetyCritical && <SafetyMark />}
          </>
        }
      />
      <div className="space-y-6 p-4">
        <p className="text-sm">{issue.description}</p>
        <FactList
          rows={[
            ["Category", issue.category],
            ["Reported", `${formatDateTime(issue.reportedAt)} by ${issue.reportedBy}`],
            ["Photos", issue.photos > 0 ? plural(issue.photos, "photo") : "None"],
            ["Work order", issue.workOrderRef ? <RefButton ctx={ctx} refId={issue.workOrderRef} /> : "None yet"],
          ]}
        />
        {issue.safetyCritical && <Note>Safety-critical reports ground the vehicle the moment they are recorded. Only a manager can release it, after a closed work order.</Note>}
        <DetailSection title="Chronology">
          <Chronology ctx={ctx} events={events} currentRef={issue.ref} />
        </DetailSection>
      </div>
      <PanelFooter
        ctx={ctx}
        steps={unplanned ? [{ key: "create-work-order", label: "Create work order", ref: issue.ref }] : []}
        waiting={unplanned && !ctx.can("create-work-order") ? "Waiting on the workshop to plan a work order." : null}
        onAct={onAct}
      />
    </>
  );
}

function EntryDetail({ ctx, entry, onAct }: { ctx: Ctx; entry: MoneyEntry; onAct: (step: Step) => void }) {
  const events = ctx.ws.timeline.filter((e) => e.ref === entry.number && e.kind !== "TRIP");
  const split = entry.amountMinor !== entry.entryTotalMinor;
  return (
    <>
      <DetailHeader
        eyebrow={`${entry.direction === "REVENUE" ? "Revenue" : "Expense"} ${entry.number}`}
        title={
          <span className="flex items-baseline justify-between gap-3">
            <span>{entry.category}</span>
            <span className="tabular-nums">{formatXaf(entry.amountMinor, { signed: entry.direction === "REVENUE" })}</span>
          </span>
        }
        meta={
          <>
            <EntryStatusBadge status={entry.status} />
            <Evidence state={entry.evidence} />
          </>
        }
      />
      <div className="space-y-6 p-4">
        <FactList
          rows={[
            ["Date", formatDate(entry.economicDate)],
            ["Cost type", LAYER_LABELS[entry.layer]],
            ["This vehicle", formatXaf(entry.amountMinor)],
            ["Whole entry", split ? `${formatXaf(entry.entryTotalMinor)}, shared with other vehicles` : "Same, not shared"],
            ["Paid to", entry.counterparty ?? "Not recorded"],
            ["Recorded by", entry.recordedBy],
            ["Linked to", <EntryLink ctx={ctx} entry={entry} />],
            ["Receipt", entry.evidence === "ATTACHED" ? "Attached" : "Not supplied"],
          ]}
        />
        <Note>
          {entry.status === "SUBMITTED"
            ? "Awaiting review: not counted in posted totals until approved. The person who recorded it cannot approve it."
            : "Posted means recorded in the books, not paid. A mistake is corrected by a reversal; the original stays."}
        </Note>
        <DetailSection title="Chronology">
          <Chronology ctx={ctx} events={events} currentRef={entry.number} />
        </DetailSection>
      </div>
      <PanelFooter
        ctx={ctx}
        steps={entryActions(entry)}
        primary={entryActions(entry).find((s) => s.key !== "reverse-entry" && ctx.can(s.key))?.key ?? null}
        waiting={entryWaiting(ctx, entry)}
        onAct={onAct}
      />
    </>
  );
}

function TripDetail({ ctx, trip, onAct }: { ctx: Ctx; trip: Trip; onAct: (step: Step) => void }) {
  const { ws } = ctx;
  const linked = ws.entries.filter((e) => e.link?.kind === "TRIP" && e.link.ref === trip.number);
  const readings = ws.readings.filter(
    (r) => (r.source === "Trip start" || r.source === "Trip end") && r.observedAt >= trip.startedAt && (trip.endedAt === null || r.observedAt <= trip.endedAt),
  );
  const events = ws.timeline.filter((e) => e.kind === "TRIP" && e.ref === trip.number);
  return (
    <>
      <DetailHeader eyebrow={`Trip ${trip.number} · ${trip.type}`} title={`${trip.from} → ${trip.to}`} meta={<TripState trip={trip} />} />
      <div className="space-y-6 p-4">
        <FactList
          rows={[
            ["Customer", trip.customer ?? "None"],
            ["Driver", trip.driver],
            ["Started", formatDateTime(trip.startedAt)],
            ["Ended", trip.endedAt ? formatDateTime(trip.endedAt) : "Still on the road"],
            ["Distance", trip.distanceKm !== null ? km(trip.distanceKm) : "Known when closed"],
            ["Revenue", trip.revenueMinor !== null ? formatXaf(trip.revenueMinor) : "None recorded"],
            ["Costs", formatXaf(trip.costMinor)],
          ]}
        />
        {trip.exceptions > 0 && <Note>Closed with {plural(trip.exceptions, "gap")}: some readings or costs were missing. Reports show the gaps; they never fill them in.</Note>}
        <DetailSection title="Linked money" aside={linked.length > 0 ? plural(linked.length, "entry", "entries") : undefined}>
          {linked.length === 0 ? (
            <p className="text-sm text-muted-foreground">No entries linked to this trip yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {linked.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => ctx.show({ kind: "entry", number: e.number })} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/50">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{e.category}</span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {e.number} · {shortDay(e.economicDate)} · {ENTRY_STATUS_LABELS[e.status].toLowerCase()}
                        {e.evidence === "MISSING" && " · no receipt"}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm tabular-nums">{formatXaf(e.amountMinor, { signed: e.direction === "REVENUE" })}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DetailSection>
        <DetailSection title="Odometer">
          {readings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No start or end reading recorded.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {readings.map((r) => (
                <li key={r.id} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">
                    {r.source} · {formatDateTime(r.observedAt)}
                  </span>
                  <span className="font-medium tabular-nums">{km(r.valueKm)}</span>
                </li>
              ))}
            </ul>
          )}
        </DetailSection>
        <DetailSection title="Chronology">
          <Chronology ctx={ctx} events={events} currentRef={trip.number} />
        </DetailSection>
      </div>
      <PanelFooter ctx={ctx} steps={tripActions(trip)} primary={trip.status === "OPEN" ? "log-fuel" : null} onAct={onAct} />
    </>
  );
}

function DocumentDetail({ ctx, doc, onAct }: { ctx: Ctx; doc: VehicleDocument; onAct: (step: Step) => void }) {
  const events = ctx.ws.timeline.filter((e) => e.ref === doc.id);
  const due = doc.state === "EXPIRED" || doc.state === "EXPIRING";
  return (
    <>
      <DetailHeader eyebrow="Document" title={doc.type} meta={<DocState doc={doc} />} />
      <div className="space-y-6 p-4">
        {doc.state === "EXPIRED" && <Note tone="danger">Expired {doc.expiresAt ? relativeDays(doc.expiresAt) : ""}. The vehicle cannot legally run until it is renewed.</Note>}
        <FactList
          rows={[
            ["Number", doc.number ?? "Not recorded"],
            ["Issued", doc.issuedAt ? formatDate(doc.issuedAt) : "Not recorded"],
            ["Expires", doc.expiresAt ? formatDate(doc.expiresAt) : "No expiry date"],
            ["Scan", doc.hasFile ? "On file" : "Not supplied"],
            ["Earlier versions", doc.previousVersions > 0 ? `${doc.previousVersions}, kept unchanged` : "None"],
          ]}
        />
        <Note>Renewing creates a new version and keeps this one. A renewal fee is recorded once, as an expense linked to the document.</Note>
        <DetailSection title="Chronology">
          <Chronology ctx={ctx} events={events} currentRef={doc.id} />
        </DetailSection>
      </div>
      <PanelFooter ctx={ctx} steps={docActions(doc)} primary={due ? "renew-document" : null} waiting={due && !ctx.can("renew-document") ? "Waiting on operations to renew it." : null} onAct={onAct} />
    </>
  );
}

function ReadingsDetail({ ctx, onAct }: { ctx: Ctx; onAct: (step: Step) => void }) {
  const { ws } = ctx;
  const readings = [...ws.readings].sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  return (
    <>
      <DetailHeader
        eyebrow="Odometer"
        title={km(ws.meter.odometerKm)}
        description={`${km(ws.meter.km30d)} in the last 30 days. Readings are never edited; a lower value is saved with a warning.`}
      />
      <div className="p-4">
        <ol className="divide-y rounded-lg border">
          {readings.map((r, i) => {
            const older = readings[i + 1];
            const delta = older ? r.valueKm - older.valueKm : null;
            return (
              <li key={r.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium tabular-nums">{km(r.valueKm)}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.source} · {r.by} · {formatDateTime(r.observedAt)}
                  </p>
                  {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
                </div>
                {delta !== null && (
                  <span className={cn("shrink-0 text-xs tabular-nums", delta < 0 ? "font-medium text-destructive" : "text-muted-foreground")}>
                    {delta >= 0 ? `+${km(delta)}` : `−${km(-delta)}`}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <PanelFooter ctx={ctx} steps={[{ key: "record-reading", label: "Record odometer", ref: null }]} primary={null} onAct={onAct} />
    </>
  );
}
