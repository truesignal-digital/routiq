// PROTOTYPE — throwaway, issue #44. Variant D "Action hub": phone-first, for
// the person standing next to the truck. Big actions first, the current state
// below, history last. Desktop is a two-column adaptation, not a wider phone.

import { Fragment, useRef, useState, type ReactNode } from "react";
import {
  BadgeCheck,
  Building2,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDollarSign,
  CloudUpload,
  Eye,
  FileText,
  Flag,
  Gauge,
  History,
  Info,
  LayoutGrid,
  ListChecks,
  Lock,
  MapPin,
  OctagonAlert,
  Phone,
  Receipt,
  Route,
  Search,
  ShieldCheck,
  StickyNote,
  TriangleAlert,
  Truck,
  Undo2,
  UserRound,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { ACTIONS, actionByKey, useVehicleActions, type ActionKey } from "./actions.js";
import {
  ENTRY_STATUS_LABELS,
  ISSUE_STATUS_LABELS,
  ROLE_LABELS,
  TODAY,
  WORK_ORDER_STATUS_LABELS,
  formatDate,
  formatDateTime,
  formatXaf,
  relativeDays,
  type DocumentState,
  type EntryStatus,
  type Issue,
  type IssueStatus,
  type MoneyEntry,
  type ProtoRole,
  type TimelineEvent,
  type TimelineKind,
  type VehicleDocument,
  type VehicleWorkspace,
  type WorkOrder,
  type WorkOrderStatus,
} from "./mockData.js";

// ─── Formatting ─────────────────────────────────────────────────────────────

type Tone = "neutral" | "critical" | "warning" | "success" | "info";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  critical: "text-red-700 dark:text-red-300",
  warning: "text-amber-700 dark:text-amber-300",
  success: "text-emerald-700 dark:text-emerald-300",
  info: "text-sky-700 dark:text-sky-300",
};

const TONE_SOFT: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  critical: "bg-red-500/10 text-red-700 dark:text-red-300",
  warning: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

const WO_TONE: Record<WorkOrderStatus, Tone> = {
  SUBMITTED: "warning",
  OPEN: "info",
  PENDING_CLOSE: "warning",
  CLOSED: "success",
  CANCELLED: "neutral",
};
const ENTRY_TONE: Record<EntryStatus, Tone> = { POSTED: "neutral", SUBMITTED: "warning", REJECTED: "critical", REVERSED: "neutral" };
const DOC_TONE: Record<DocumentState, Tone> = { EXPIRED: "critical", EXPIRING: "warning", VALID: "success", NO_EXPIRY: "neutral" };
const ISSUE_TONE: Record<IssueStatus, Tone> = { OPEN: "warning", IN_WORK: "info", RESOLVED: "success", DISMISSED: "neutral" };

const LIFECYCLE_LABELS: Record<string, string> = {
  REGISTERED: "Registered",
  IN_SERVICE: "In service",
  UNDER_MAINTENANCE: "Under maintenance",
  SOLD: "Sold",
  RETIRED: "Retired",
  WRITTEN_OFF: "Written off",
};

const KIND_ICON: Record<TimelineKind, LucideIcon> = {
  ISSUE: TriangleAlert,
  GROUNDED: OctagonAlert,
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

const km = (n: number) => `${new Intl.NumberFormat("en-US").format(n)} km`;

function shortDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function daysFromToday(iso: string): number {
  return Math.round((Date.parse(`${iso.slice(0, 10)}T12:00:00`) - Date.parse(`${TODAY}T12:00:00`)) / 86_400_000);
}

/** Recent things read as "3 days ago"; older ones as a date. */
function when(iso: string): string {
  const ago = -daysFromToday(iso);
  if (ago >= 0 && ago < 7) return relativeDays(iso);
  return ago < 300 ? shortDate(iso) : formatDate(iso);
}

function dueLabel(iso: string): string {
  const days = daysFromToday(iso);
  if (days < 0) return `overdue by ${-days} ${-days === 1 ? "day" : "days"}`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `due ${shortDate(iso)}`;
}

const docName = (doc: VehicleDocument) => doc.type.replace(/\s*\(.*\)$/, "");

function docStateLabel(doc: VehicleDocument): string {
  if (doc.state === "EXPIRED" && doc.expiresAt) return `Expired ${shortDate(doc.expiresAt)}`;
  if (doc.state === "EXPIRING" && doc.daysLeft !== null) return `Expires in ${doc.daysLeft} days`;
  if (doc.state === "VALID" && doc.expiresAt) return `Valid until ${formatDate(doc.expiresAt)}`;
  return "No expiry";
}

const steps = (wo: WorkOrder) => {
  const done = wo.checklist.filter((c) => c.done).length;
  return { done, total: wo.checklist.length };
};
const stepsLabel = (wo: WorkOrder) => {
  const s = steps(wo);
  return s.total === 0 ? "no checklist" : `${s.done} of ${s.total} steps done`;
};

/** Form option strings, so a prefilled select lands on the right choice. */
const woOption = (wo: WorkOrder) => `${wo.ref} · ${wo.title}`;
const issueOption = (issue: Issue) => `${issue.ref} · ${issue.title}`;

// ─── Derived facts ──────────────────────────────────────────────────────────

function derive(ws: VehicleWorkspace) {
  const r = ws.readiness;
  const groundingRef = r.state === "GROUNDED" ? r.workOrderRef : null;
  const awaitingReview = ws.entries.filter((e) => e.status === "SUBMITTED");
  return {
    grounded: r.state === "GROUNDED",
    groundingWo: groundingRef ? (ws.workOrders.find((w) => w.ref === groundingRef) ?? null) : null,
    activeWorkOrders: ws.workOrders.filter((w) => w.status === "SUBMITTED" || w.status === "OPEN" || w.status === "PENDING_CLOSE"),
    inProgress: ws.workOrders.find((w) => w.status === "OPEN") ?? null,
    awaitingSignOff: ws.workOrders.find((w) => w.status === "PENDING_CLOSE") ?? null,
    awaitingAuthorization: ws.workOrders.find((w) => w.status === "SUBMITTED") ?? null,
    unresolvedIssues: ws.issues.filter((i) => i.status === "OPEN" || i.status === "IN_WORK"),
    issueWithoutWo: ws.issues.find((i) => i.status === "OPEN" && i.workOrderRef === null) ?? null,
    lastFuel:
      ws.entries
        .filter((e) => e.category === "Fuel" && e.direction === "EXPENSE" && e.status !== "REVERSED")
        .sort((a, b) => b.economicDate.localeCompare(a.economicDate))[0] ?? null,
    awaitingReview,
    awaitingReviewMinor: awaitingReview.reduce((sum, e) => sum + e.amountMinor, 0),
    missingReceipts: ws.entries.filter((e) => e.evidence === "MISSING" && (e.status === "POSTED" || e.status === "SUBMITTED")),
    urgentDoc:
      ws.documents
        .filter((x) => x.state === "EXPIRED" || x.state === "EXPIRING")
        .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))[0] ?? null,
    docCounts: {
      expired: ws.documents.filter((x) => x.state === "EXPIRED").length,
      expiring: ws.documents.filter((x) => x.state === "EXPIRING").length,
      valid: ws.documents.filter((x) => x.state === "VALID").length,
      noExpiry: ws.documents.filter((x) => x.state === "NO_EXPIRY").length,
    },
    timeline: [...ws.timeline].sort((a, b) => b.at.localeCompare(a.at)),
  };
}
type Derived = ReturnType<typeof derive>;

// ─── Records reachable from any ref ─────────────────────────────────────────

type Target =
  | { kind: "wo" | "issue" | "entry" | "doc" | "trip"; ref: string }
  | { kind: "workorders" | "docs" | "money" };

function resolveRef(ws: VehicleWorkspace, code: string, hint?: TimelineKind): Target | null {
  if (ws.workOrders.some((w) => w.ref === code)) return { kind: "wo", ref: code };
  if (ws.issues.some((i) => i.ref === code)) return { kind: "issue", ref: code };
  const doc = ws.documents.find((x) => x.id === code || x.number === code);
  if (doc) return { kind: "doc", ref: doc.id };
  const isTrip = ws.trips.some((t) => t.number === code);
  const isEntry = ws.entries.some((e) => e.number === code);
  if (isTrip && (hint === "TRIP" || !isEntry)) return { kind: "trip", ref: code };
  if (isEntry) return { kind: "entry", ref: code };
  return null;
}

function refPattern(ws: VehicleWorkspace): RegExp | null {
  const tokens = [
    ...ws.workOrders.map((w) => w.ref),
    ...ws.issues.map((i) => i.ref),
    ...ws.entries.map((e) => e.number),
    ...ws.trips.map((t) => t.number),
    ...ws.documents.flatMap((x) => (x.number && x.number !== ws.vehicle.plate ? [x.number] : [])),
  ];
  if (tokens.length === 0) return null;
  const alts = [...new Set(tokens)]
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(`(?<![\\w-])(${alts})(?![\\w-])`);
}

// ─── Context passed to every block ──────────────────────────────────────────

interface Ctx {
  ws: VehicleWorkspace;
  d: Derived;
  role: ProtoRole;
  readOnly: boolean;
  can: (key: ActionKey) => boolean;
  act: (key: ActionKey, ref?: string | null) => void;
  show: (target: Target) => void;
}

const isActionKey = (key: string): key is ActionKey => ACTIONS.some((a) => a.key === key);

// ─── Action tiles ───────────────────────────────────────────────────────────

interface Tile {
  key: ActionKey;
  label: string;
  icon: LucideIcon;
  hint: string;
  ref: string | null;
  hintTone?: Tone;
  count?: number;
  blocked?: { reason: string; linkRef: string | null; linkLabel: string };
}

/** Most frequent first, per role. Anything the role cannot do drops out. */
const TILE_PLAN: Record<ProtoRole, readonly ActionKey[]> = {
  FIELD_SUBMITTER: ["log-fuel", "record-reading", "report-issue", "record-expense", "start-trip", "add-note"],
  MAINTENANCE: ["report-issue", "create-work-order", "complete-work-order", "record-expense", "record-reading", "open-work-order", "add-note", "schedule-service"],
  OPS_MANAGER: ["report-issue", "release-to-service", "renew-document", "assign-custodian", "start-trip", "create-work-order"],
  ADMIN: ["report-issue", "release-to-service", "renew-document", "assign-custodian", "start-trip", "create-work-order"],
  FINANCE_APPROVER: ["review-entry", "approve-closure", "attach-receipt", "record-expense", "reverse-entry", "record-revenue"],
  EXECUTIVE_VIEWER: [],
};

/** The contextual version of an action: its hint, prefilled ref, or why it is blocked. */
function tileFor(key: ActionKey, ctx: Pick<Ctx, "ws" | "d" | "role">): Tile | null {
  const { ws, d, role } = ctx;
  const a = actionByKey(key);
  const base: Tile = { key, label: a.label, icon: a.icon, hint: "", ref: null };
  switch (key) {
    case "log-fuel":
      return { ...base, hint: d.lastFuel ? `Last fill ${shortDate(d.lastFuel.economicDate)}` : "Litres, amount, receipt" };
    case "record-reading":
      return { ...base, hint: `Last ${km(ws.meter.odometerKm)}` };
    case "report-issue":
      return { ...base, hint: d.unresolvedIssues.length > 0 ? `${d.unresolvedIssues.length} already open` : "Photo and a few words" };
    case "record-expense":
      if (role === "MAINTENANCE" && d.inProgress) return { ...base, label: "Record parts", ref: woOption(d.inProgress), hint: `On ${d.inProgress.ref}` };
      return { ...base, hint: "Tolls, parking, repairs" };
    case "start-trip":
      return d.grounded ? { ...base, hint: "Truck is grounded", hintTone: "critical" } : { ...base, hint: `From ${km(ws.meter.odometerKm)}` };
    case "add-note":
      return { ...base, hint: "Kept in the history" };
    case "create-work-order":
      return d.issueWithoutWo ? { ...base, ref: issueOption(d.issueWithoutWo), hint: `${d.issueWithoutWo.ref} not planned yet` } : { ...base, hint: "What, who, by when" };
    case "complete-work-order":
      if (!d.inProgress) return { ...base, blocked: { reason: "No work order in progress", linkRef: null, linkLabel: "" } };
      return { ...base, ref: d.inProgress.ref, hint: `${d.inProgress.ref} · ${d.inProgress.dueBy ? dueLabel(d.inProgress.dueBy) : "in progress"}` };
    case "open-work-order":
      return d.inProgress ? { ...base, label: "See checklist", icon: ListChecks, ref: d.inProgress.ref, hint: `${d.inProgress.ref} · ${steps(d.inProgress).done} of ${steps(d.inProgress).total} done` } : null;
    case "cancel-work-order":
      return { ...base, ref: d.inProgress?.ref ?? null };
    case "approve-work-order":
      return { ...base, ref: d.awaitingAuthorization?.ref ?? null, hint: d.awaitingAuthorization ? d.awaitingAuthorization.ref : "Nothing waiting" };
    case "schedule-service":
      return { ...base, hint: "Every N km or days" };
    case "release-to-service": {
      if (!d.grounded) return { ...base, blocked: { reason: "The truck is not grounded", linkRef: null, linkLabel: "" } };
      const wo = d.groundingWo;
      if (wo && wo.status !== "CLOSED") {
        return {
          ...base,
          blocked: {
            reason: `Needs ${wo.ref} closed and signed off`,
            linkRef: wo.ref,
            linkLabel: `See ${wo.ref} · ${steps(wo).done}/${steps(wo).total} steps`,
          },
        };
      }
      return { ...base, hint: wo ? `${wo.ref} is closed` : "Road test and a note" };
    }
    case "renew-document": {
      const doc = d.urgentDoc;
      if (!doc) return { ...base, hint: "Nothing due" };
      return {
        ...base,
        ref: doc.id,
        hint: doc.state === "EXPIRED" ? `${docName(doc)} expired` : `${docName(doc)} in ${doc.daysLeft ?? "?"} days`,
        hintTone: doc.state === "EXPIRED" ? "critical" : "warning",
      };
    }
    case "assign-custodian":
      return { ...base, hint: ws.custodian ? `Now ${ws.custodian.name}` : "Nobody assigned" };
    case "review-entry":
      return {
        ...base,
        label: "Review entries",
        ref: d.awaitingReview[0]?.number ?? null,
        count: d.awaitingReview.length,
        hint: d.awaitingReview.length > 0 ? `${formatXaf(d.awaitingReviewMinor)} waiting` : "Nothing waiting",
      };
    case "approve-closure":
      if (!d.awaitingSignOff) return null;
      return { ...base, label: "Sign off work", ref: d.awaitingSignOff.ref, hint: `${d.awaitingSignOff.ref} · ${formatXaf(d.awaitingSignOff.actualCostMinor ?? 0)}` };
    case "attach-receipt": {
      const first = d.missingReceipts[0];
      if (!first) return { ...base, hint: "No receipts missing" };
      const n = d.missingReceipts.length;
      return { ...base, ref: first.number, hint: `${n} ${n === 1 ? "entry" : "entries"} without proof`, hintTone: "warning" };
    }
    case "reverse-entry":
      return { ...base, hint: "Corrects posted money" };
    case "record-revenue":
      return { ...base, hint: ws.vehicle.templateCode === "PASSENGER_TRANSPORT" ? "Fares" : "Freight" };
    default:
      return base;
  }
}

function ActionTile({ tile, primary, ctx }: { tile: Tile; primary: boolean; ctx: Ctx }) {
  const Icon = tile.icon;
  if (tile.blocked) {
    const linkRef = tile.blocked.linkRef;
    const target = linkRef ? resolveRef(ctx.ws, linkRef) : null;
    return (
      <div aria-disabled="true" className="flex min-h-[104px] flex-col justify-between gap-3 rounded-xl border border-dashed bg-muted/40 p-3">
        <span className="flex items-start justify-between">
          <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="size-5" aria-hidden />
          </span>
          <Lock className="size-4 text-muted-foreground" aria-label="Not available yet" />
        </span>
        <span className="grid gap-1">
          <span className="text-base leading-tight font-semibold text-muted-foreground">{tile.label}</span>
          <span className="text-xs leading-snug text-muted-foreground">{tile.blocked.reason}</span>
          {target && (
            <button
              type="button"
              onClick={() => ctx.show(target)}
              className="mt-0.5 inline-flex w-fit items-center gap-0.5 text-xs font-medium text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
            >
              {tile.blocked.linkLabel}
              <ChevronRight className="size-3" aria-hidden />
            </button>
          )}
        </span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => ctx.act(tile.key, tile.ref)}
      className={cn(
        "group relative flex min-h-[104px] flex-col justify-between gap-3 rounded-xl border p-3 text-left transition-[background-color,transform] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]",
        primary ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90" : "bg-card hover:border-foreground/20 hover:bg-muted/50",
      )}
    >
      <span className={cn("flex size-10 items-center justify-center rounded-lg", primary ? "bg-primary-foreground/15" : "bg-muted")}>
        <Icon className="size-5" aria-hidden />
      </span>
      {tile.count !== undefined && tile.count > 0 && (
        <span className="absolute top-3 right-3 flex h-6 min-w-6 items-center justify-center rounded-md bg-amber-500/15 px-1.5 text-xs font-semibold text-amber-800 tabular-nums dark:text-amber-200">
          {tile.count}
        </span>
      )}
      <span className="grid gap-0.5">
        <span className="text-base leading-tight font-semibold">{tile.label}</span>
        {tile.hint && (
          <span
            className={cn(
              "text-xs leading-snug",
              primary ? "text-primary-foreground/70" : tile.hintTone ? TONE_TEXT[tile.hintTone] : "text-muted-foreground",
            )}
          >
            {tile.hint}
          </span>
        )}
      </span>
    </button>
  );
}

function ActionGrid({ ctx, total, onAll }: { ctx: Ctx; total: number; onAll: () => void }) {
  const tiles = TILE_PLAN[ctx.role]
    .filter((key) => ctx.can(key))
    .map((key) => tileFor(key, ctx))
    .filter((t): t is Tile => t !== null)
    .slice(0, 6);
  return (
    <section aria-labelledby="vd-actions">
      <SectionTitle id="vd-actions">What do you want to do?</SectionTitle>
      <div className="mt-2.5 grid grid-cols-2 gap-2.5 @xl:grid-cols-3">
        {tiles.map((tile, i) => (
          <ActionTile key={tile.key} tile={tile} primary={i === 0} ctx={ctx} />
        ))}
      </div>
      <button
        type="button"
        onClick={onAll}
        className="mt-2.5 flex min-h-14 w-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left transition-colors outline-none hover:border-foreground/20 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <LayoutGrid className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base leading-tight font-semibold">All actions</span>
          <span className="block text-xs text-muted-foreground">{total} for your role, by topic</span>
        </span>
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </button>
    </section>
  );
}

// ─── Executive: what the truck costs, read-only ─────────────────────────────

function CostSummary({ ctx }: { ctx: Ctx }) {
  const { ws, d } = ctx;
  const m = ws.money;
  const max = Math.max(1, ...m.byCategory.map((c) => c.minor));
  const cells: Array<{ label: string; value: string; note: string; tone: Tone }> = [
    { label: `Posted, ${m.periodLabel}`, value: formatXaf(m.postedExpenseMinor), note: "All layers: direct, maintenance, ownership share", tone: "neutral" },
    {
      label: "Awaiting review",
      value: formatXaf(m.pendingReviewMinor),
      note: `${m.pendingReviewCount} ${m.pendingReviewCount === 1 ? "entry" : "entries"}, not in the posted figure`,
      tone: m.pendingReviewCount > 0 ? "warning" : "neutral",
    },
    {
      label: "Missing receipts",
      value: String(d.missingReceipts.length),
      note: d.missingReceipts.length > 0 ? "Recorded without proof" : "Every entry has proof",
      tone: d.missingReceipts.length > 0 ? "warning" : "neutral",
    },
    {
      label: "Lifetime net",
      value: formatXaf(m.lifetime.netMinor, { signed: true }),
      note: `${formatXaf(m.lifetime.revenueMinor)} revenue − ${formatXaf(m.lifetime.expenseMinor)} expenses`,
      tone: "neutral",
    },
  ];
  return (
    <section aria-labelledby="vd-cost">
      <SectionTitle
        id="vd-cost"
        aside={
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Eye className="size-3.5" aria-hidden />
            Read-only view
          </span>
        }
      >
        What this truck costs
      </SectionTitle>
      <div className="mt-2.5 overflow-hidden rounded-xl border bg-card">
        <div className="grid grid-cols-2 gap-px bg-border">
          {cells.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => ctx.show({ kind: "money" })}
              className="flex flex-col gap-1 bg-card p-3 text-left transition-colors hover:bg-muted/50 @xl:p-4"
            >
              <span className="text-xs text-muted-foreground">{c.label}</span>
              <span className={cn("text-lg leading-tight font-semibold tabular-nums @xl:text-xl", c.tone !== "neutral" && TONE_TEXT[c.tone])}>{c.value}</span>
              <span className="text-xs leading-snug text-muted-foreground">{c.note}</span>
            </button>
          ))}
        </div>
        <div className="border-t p-3 @xl:p-4">
          <h3 className="text-xs font-medium text-muted-foreground">Posted in {m.periodLabel}, by category</h3>
          <ul className="mt-2 grid gap-2">
            {m.byCategory.map((c) => (
              <li key={c.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
                <span className="truncate">{c.label}</span>
                <span className="tabular-nums">{formatXaf(c.minor)}</span>
                <span className="col-span-2 h-1.5 overflow-hidden rounded-sm bg-muted">
                  <span className="block h-full rounded-sm bg-foreground/35" style={{ width: `${Math.round((c.minor / max) * 100)}%` }} />
                </span>
              </li>
            ))}
          </ul>
          {m.costPerKm && (
            <p className="mt-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground tabular-nums">{formatXaf(m.costPerKm.minor)}/km</span> · {m.costPerKm.basis}
            </p>
          )}
        </div>
        <p className="flex items-start gap-2 border-t bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground @xl:px-4">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          You can open every record from here. Recording, approving and correcting are done by your team.
        </p>
      </div>
    </section>
  );
}

// ─── Identity + readiness ───────────────────────────────────────────────────

function IdentityCard({ ctx }: { ctx: Ctx }) {
  const v = ctx.ws.vehicle;
  const description = [[v.make, v.model].filter(Boolean).join(" "), v.year, v.classLabel].filter(Boolean).join(" · ");
  return (
    <section aria-label="Vehicle" className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-start gap-3 p-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Truck className="size-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h1 className="text-xl leading-tight font-semibold tracking-tight">{v.code}</h1>
            <span className="text-base font-medium text-muted-foreground tabular-nums">{v.plate ?? "Plate not recorded"}</span>
          </div>
          <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{description}</p>
          <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
            <Building2 className="size-3.5 shrink-0" aria-hidden />
            Home branch {v.homeBranch.name}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[11px] leading-tight text-muted-foreground">Lifecycle</div>
          <div className="text-xs font-medium">{LIFECYCLE_LABELS[v.lifecycle] ?? v.lifecycle}</div>
        </div>
      </div>
      <ReadinessBand ctx={ctx} />
      {!ctx.readOnly && (
        <div className="flex items-center gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
          <CloudUpload className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">Saved on this phone, will send when online</span>
          <span className="shrink-0 rounded-md border border-dashed px-1.5 py-px text-[11px]">Concept</span>
        </div>
      )}
    </section>
  );
}

function ReadinessBand({ ctx }: { ctx: Ctx }) {
  const r = ctx.ws.readiness;
  if (r.state === "GROUNDED") {
    const days = -daysFromToday(r.since);
    const issue = resolveRef(ctx.ws, r.issueRef);
    const wo = ctx.d.groundingWo;
    return (
      <div className="flex items-start gap-3 border-t border-red-500/20 bg-red-500/10 px-4 py-3 text-red-900 dark:text-red-100">
        <OctagonAlert className="mt-0.5 size-5 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
        <div className="min-w-0">
          <p className="text-base leading-snug font-semibold">
            Grounded since {shortDate(r.since)}
            <span className="font-normal text-red-900/70 dark:text-red-100/70"> · {days} {days === 1 ? "day" : "days"}</span>
          </p>
          <p className="text-sm leading-snug">
            {r.reason}
            <span className="text-red-900/70 dark:text-red-100/70">, reported by {r.reportedBy}</span>
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-red-900/80 dark:text-red-100/80">
            {issue ? <RefLink onGo={() => ctx.show(issue)}>{r.issueRef}</RefLink> : <span>{r.issueRef}</span>}
            {wo && (
              <>
                <ChevronRight className="size-3" aria-label="led to" />
                <RefLink onGo={() => ctx.show({ kind: "wo", ref: wo.ref })}>{wo.ref}</RefLink>
                <span>
                  {WORK_ORDER_STATUS_LABELS[wo.status].toLowerCase()}
                  {wo.dueBy ? `, ${dueLabel(wo.dueBy)}` : ""}
                </span>
              </>
            )}
          </p>
        </div>
      </div>
    );
  }
  if (r.state === "AVAILABLE") {
    return (
      <div className="flex items-center gap-3 border-t border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-emerald-900 dark:text-emerald-100">
        <ShieldCheck className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <p className="text-base font-semibold">
          Available <span className="font-normal opacity-70">since {shortDate(r.since)}</span>
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 border-t bg-muted/50 px-4 py-3">
      <Circle className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <p className="text-base font-semibold text-muted-foreground">Availability not assessed</p>
    </div>
  );
}

// ─── Needs you ──────────────────────────────────────────────────────────────

const SEVERITY: Record<"critical" | "warning" | "info", { icon: LucideIcon; tone: Tone; label: string }> = {
  critical: { icon: OctagonAlert, tone: "critical", label: "Critical" },
  warning: { icon: TriangleAlert, tone: "warning", label: "Warning" },
  info: { icon: Info, tone: "info", label: "For information" },
};

function NeedsYou({ ctx }: { ctx: Ctx }) {
  const items = ctx.readOnly ? ctx.ws.attention : ctx.ws.attention.filter((a) => isActionKey(a.actionKey) && ctx.can(a.actionKey));
  const rowGrid = cn(
    "grid items-start gap-x-3 gap-y-2 px-4 py-3",
    ctx.readOnly ? "grid-cols-[auto_minmax(0,1fr)_auto]" : "grid-cols-[auto_minmax(0,1fr)] @xl:grid-cols-[auto_minmax(0,1fr)_auto]",
  );
  return (
    <section aria-labelledby="vd-needs">
      <SectionTitle id="vd-needs" aside={items.length > 0 ? <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span> : null}>
        {ctx.readOnly ? "What needs attention" : "Needs you"}
      </SectionTitle>
      {items.length === 0 ? (
        <div className="mt-2.5 flex items-center gap-3 rounded-xl border bg-card px-4 py-4 text-sm text-muted-foreground">
          <CircleCheck className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          Nothing needs you on this truck right now.
        </div>
      ) : (
        <ul className="mt-2.5 divide-y overflow-hidden rounded-xl border bg-card">
          {items.map((item) => {
            const sev = SEVERITY[item.severity];
            const SevIcon = sev.icon;
            const key = isActionKey(item.actionKey) ? item.actionKey : null;
            const target = item.ref ? resolveRef(ctx.ws, item.ref) : null;
            const onClick = ctx.readOnly ? (target ? () => ctx.show(target) : null) : key ? () => ctx.act(key, item.ref) : null;
            const body = (
              <>
                <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", TONE_SOFT[sev.tone])}>
                  <SevIcon className="size-4" aria-hidden />
                  <span className="sr-only">{sev.label}</span>
                </span>
                <span className="min-w-0">
                  <span className="block text-sm leading-snug font-medium">{item.title}</span>
                  <span className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{item.detail}</span>
                </span>
                {onClick &&
                  (ctx.readOnly ? (
                    <ChevronRight className="size-4 shrink-0 self-center text-muted-foreground" aria-hidden />
                  ) : (
                    <span className="col-start-2 -mt-1 inline-flex items-center gap-0.5 justify-self-start text-sm font-semibold whitespace-nowrap @xl:col-start-3 @xl:mt-0 @xl:h-8 @xl:self-center @xl:rounded-md @xl:border @xl:bg-background @xl:px-2.5 @xl:text-xs @xl:font-medium @xl:transition-colors @xl:group-hover:border-foreground/25">
                      {item.actionLabel}
                      <ChevronRight className="size-4 @xl:hidden" aria-hidden />
                    </span>
                  ))}
              </>
            );
            return (
              <li key={item.id}>
                {onClick ? (
                  <button type="button" onClick={onClick} className={cn(rowGrid, "group min-h-16 w-full text-left transition-colors hover:bg-muted/50")}>
                    {body}
                  </button>
                ) : (
                  <div className={rowGrid}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── Right now ──────────────────────────────────────────────────────────────

function StateRow({
  icon: Icon,
  label,
  children,
  action,
  onOpen,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
  action?: { label: string; onClick: () => void } | null;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">{label}</span>
        {children}
      </span>
    </>
  );
  return (
    <div className="flex items-start gap-2 px-4 py-3">
      {onOpen ? (
        <button type="button" onClick={onOpen} className="group flex min-w-0 flex-1 items-start gap-3 text-left">
          {body}
          <ChevronRight className="mt-4 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-3">{body}</div>
      )}
      {action && (
        <Button variant="outline" size="sm" className="mt-1 h-8 shrink-0" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

function RightNow({ ctx }: { ctx: Ctx }) {
  const { ws, d } = ctx;
  const c = ws.custodian;
  const loc = ws.location;
  const first = d.activeWorkOrders[0];
  const others = d.activeWorkOrders.slice(1);
  const docParts: Array<{ n: number; label: string; tone: Tone }> = [
    { n: d.docCounts.expired, label: "expired", tone: "critical" as const },
    { n: d.docCounts.expiring, label: "expiring", tone: "warning" as const },
    { n: d.docCounts.valid, label: "valid", tone: "neutral" as const },
    { n: d.docCounts.noExpiry, label: "no expiry", tone: "neutral" as const },
  ].filter((p) => p.n > 0);
  return (
    <section aria-labelledby="vd-now">
      <SectionTitle id="vd-now">Right now</SectionTitle>
      <div className="mt-2.5 divide-y rounded-xl border bg-card">
        <StateRow
          icon={UserRound}
          label="Custodian (accountable)"
          action={ctx.can("assign-custodian") ? { label: "Change", onClick: () => ctx.act("assign-custodian") } : null}
        >
          {c ? (
            <>
              <span className="block text-sm font-medium">{c.name}</span>
              <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                {c.kind} since {shortDate(c.since)}
                <span aria-hidden>·</span>
                <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground">
                  <Phone className="size-3" aria-hidden />
                  {c.phone}
                </a>
              </span>
            </>
          ) : (
            <span className="block text-sm text-muted-foreground">Nobody assigned</span>
          )}
        </StateRow>

        <StateRow
          icon={MapPin}
          label="Reported location"
          action={ctx.can("report-location") ? { label: "Update", onClick: () => ctx.act("report-location") } : null}
        >
          {loc.state === "REPORTED" ? (
            <>
              <span className="block text-sm font-medium">{loc.place}</span>
              <span className="block text-xs text-muted-foreground">
                {when(loc.observedAt)} at {formatDateTime(loc.observedAt).split(", ")[1]} · via {loc.source.toLowerCase()}
              </span>
            </>
          ) : (
            <>
              <span className="block text-sm font-medium text-muted-foreground">No report</span>
              <span className="block text-xs text-muted-foreground">Nobody has said where it is</span>
            </>
          )}
        </StateRow>

        <StateRow
          icon={Gauge}
          label="Odometer"
          action={ctx.can("record-reading") ? { label: "Record", onClick: () => ctx.act("record-reading") } : null}
        >
          <span className="block text-sm font-medium tabular-nums">{km(ws.meter.odometerKm)}</span>
          <span className="block text-xs text-muted-foreground">
            {when(ws.meter.observedAt)} · {ws.meter.source.toLowerCase()}, {ws.meter.observedBy}
          </span>
          <span className="block text-xs text-muted-foreground tabular-nums">{km(ws.meter.km30d)} driven in the last 30 days</span>
        </StateRow>

        <div className="px-4 py-3">
          <div className="flex items-start gap-3">
            <Wrench className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted-foreground">Work orders</span>
                <button type="button" onClick={() => ctx.show({ kind: "workorders" })} className="text-xs font-medium underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground">
                  All {ws.workOrders.length}
                </button>
              </div>
              <span className="block text-sm font-medium">{d.activeWorkOrders.length === 0 ? "None open" : `${d.activeWorkOrders.length} open`}</span>
              {first && (
                <button
                  type="button"
                  onClick={() => ctx.show({ kind: "wo", ref: first.ref })}
                  className="mt-2 block w-full rounded-lg border bg-background p-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/40"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold tabular-nums">{first.ref}</span>
                    <StatusLabel tone={WO_TONE[first.status]}>{WORK_ORDER_STATUS_LABELS[first.status]}</StatusLabel>
                  </span>
                  <span className="mt-0.5 block truncate text-sm">{first.title}</span>
                  {first.checklist.length > 0 && (
                    <span className="mt-2 flex items-center gap-2">
                      <Progress {...steps(first)} />
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {steps(first).done}/{steps(first).total} steps
                      </span>
                    </span>
                  )}
                  <span className="mt-1.5 block text-xs text-muted-foreground">
                    {first.assignee}
                    {first.dueBy ? ` · ${dueLabel(first.dueBy)}` : ""}
                  </span>
                </button>
              )}
              {others.map((wo) => (
                <button
                  key={wo.id}
                  type="button"
                  onClick={() => ctx.show({ kind: "wo", ref: wo.ref })}
                  className="mt-1.5 flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm hover:bg-muted/50"
                >
                  <span className="font-medium tabular-nums">{wo.ref}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{WORK_ORDER_STATUS_LABELS[wo.status]}</span>
                  <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
                </button>
              ))}
            </div>
          </div>
        </div>

        <StateRow icon={FileText} label="Documents" onOpen={() => ctx.show({ kind: "docs" })}>
          <span className="mt-0.5 flex flex-wrap gap-1">
            {docParts.map((p) => (
              <StatusLabel key={p.label} tone={p.tone}>
                {p.n} {p.label}
              </StatusLabel>
            ))}
          </span>
          {d.urgentDoc && (
            <span className="mt-1 block text-xs text-muted-foreground">
              {docName(d.urgentDoc)}: {docStateLabel(d.urgentDoc).toLowerCase()}
            </span>
          )}
        </StateRow>

        <StateRow icon={Wallet} label={`Posted spend · ${ws.money.periodLabel}`} onOpen={() => ctx.show({ kind: "money" })}>
          <span className="block text-sm font-medium tabular-nums">{formatXaf(ws.money.postedExpenseMinor)}</span>
          {ws.money.pendingReviewCount > 0 && (
            <span className="block text-xs text-muted-foreground">
              <span className="text-amber-700 tabular-nums dark:text-amber-300">+{formatXaf(ws.money.pendingReviewMinor)}</span> awaiting review, not included
            </span>
          )}
          {d.missingReceipts.length > 0 && (
            <span className="block text-xs text-amber-700 dark:text-amber-300">
              {d.missingReceipts.length} {d.missingReceipts.length === 1 ? "receipt" : "receipts"} missing
            </span>
          )}
        </StateRow>
      </div>
    </section>
  );
}

// ─── Recent history ─────────────────────────────────────────────────────────

function KindIcon({ kind, tone }: { kind: TimelineKind; tone: Tone }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", TONE_SOFT[tone])}>
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

const eventAmount = (ev: TimelineEvent) => (ev.amountMinor === null ? null : formatXaf(ev.amountMinor, { signed: ev.kind === "REVENUE" }));

function RecentHistory({ ctx, onFull }: { ctx: Ctx; onFull: () => void }) {
  const events = ctx.d.timeline.slice(0, 6);
  return (
    <section aria-labelledby="vd-history">
      <SectionTitle id="vd-history" aside={<span className="text-xs text-muted-foreground">Latest {events.length} of {ctx.d.timeline.length}</span>}>
        Recent history
      </SectionTitle>
      <ul className="mt-2.5 divide-y overflow-hidden rounded-xl border bg-card">
        {events.map((ev) => {
          const target = ev.ref ? resolveRef(ctx.ws, ev.ref, ev.kind) : null;
          const amount = eventAmount(ev);
          const body = (
            <>
              <KindIcon kind={ev.kind} tone={ev.tone} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{ev.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {ev.actor} · {when(ev.at)}
                </span>
              </span>
              {amount && <span className="shrink-0 text-sm tabular-nums">{amount}</span>}
            </>
          );
          return (
            <li key={ev.id}>
              {target ? (
                <button type="button" onClick={() => ctx.show(target)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50">
                  {body}
                </button>
              ) : (
                <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      <Button variant="outline" className="mt-2.5 h-11 w-full gap-2 text-sm" onClick={onFull}>
        <History aria-hidden />
        Full history
      </Button>
    </section>
  );
}

// ─── Full history sheet ─────────────────────────────────────────────────────

const HISTORY_FILTERS = [
  { id: "all", label: "All", kinds: null },
  { id: "work", label: "Problems & work", kinds: ["ISSUE", "GROUNDED", "WORK_ORDER", "RELEASED"] },
  { id: "money", label: "Money", kinds: ["EXPENSE", "REVENUE", "APPROVAL", "REVERSAL"] },
  { id: "trips", label: "Trips & odometer", kinds: ["TRIP", "READING"] },
  { id: "docs", label: "Documents", kinds: ["DOCUMENT"] },
  { id: "vehicle", label: "Custody & lifecycle", kinds: ["ASSIGNMENT", "LIFECYCLE", "NOTE"] },
] as const satisfies ReadonlyArray<{ id: string; label: string; kinds: readonly TimelineKind[] | null }>;
type HistoryFilterId = (typeof HISTORY_FILTERS)[number]["id"];

function inFilter(ev: TimelineEvent, id: HistoryFilterId): boolean {
  const f = HISTORY_FILTERS.find((x) => x.id === id);
  if (!f || f.kinds === null) return true;
  return (f.kinds as readonly TimelineKind[]).includes(ev.kind);
}

const localDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA");

function dayLabel(key: string): string {
  const today = new Date(`${TODAY}T12:00:00`);
  const yesterday = new Date(today.getTime() - 86_400_000).toLocaleDateString("en-CA");
  if (key === today.toLocaleDateString("en-CA")) return "Today";
  if (key === yesterday) return "Yesterday";
  return new Date(`${key}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function HistorySheet({
  ctx,
  open,
  onOpenChange,
  query,
  onQuery,
  filter,
  onFilter,
}: {
  ctx: Ctx;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQuery: (q: string) => void;
  filter: HistoryFilterId;
  onFilter: (id: HistoryFilterId) => void;
}) {
  const q = query.trim().toLowerCase();
  const matching = ctx.d.timeline.filter((ev) => !q || [ev.title, ev.detail ?? "", ev.actor, ev.ref ?? ""].join(" ").toLowerCase().includes(q));
  const shown = matching.filter((ev) => inFilter(ev, filter));
  const groups: Array<{ key: string; events: TimelineEvent[] }> = [];
  for (const ev of shown) {
    const key = localDay(ev.at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push(ev);
    else groups.push({ key, events: [ev] });
  }
  const go = (t: Target) => ctx.show(t);
  const headerRef = useRef<HTMLDivElement>(null);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" initialFocus={headerRef} className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader ref={headerRef} tabIndex={-1} className="gap-3 border-b pr-12 outline-none">
          <div>
            <SheetTitle>Full history · {ctx.ws.vehicle.code}</SheetTitle>
            <SheetDescription>Every record, newest first. Corrections are their own events; nothing is edited away.</SheetDescription>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search events, refs, people" aria-label="Search history" className="h-10 pl-9" />
          </div>
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label="Filter by kind">
            {HISTORY_FILTERS.map((f) => {
              const active = filter === f.id;
              const n = matching.filter((ev) => inFilter(ev, f.id)).length;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onFilter(f.id)}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors",
                    active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                  )}
                >
                  {f.label}
                  <span className={cn("text-xs tabular-nums", active ? "text-primary-foreground/70" : "text-muted-foreground")}>{n}</span>
                </button>
              );
            })}
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.length === 0 ? (
            <div className="grid place-items-center gap-3 px-6 py-16 text-center">
              <History className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">No events match{q ? ` “${query.trim()}”` : ""} in this filter.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onQuery("");
                  onFilter("all");
                }}
              >
                Clear search and filter
              </Button>
            </div>
          ) : (
            <>
              {groups.map((g) => (
                <section key={g.key} aria-label={dayLabel(g.key)}>
                  <h3 className="sticky top-0 z-10 border-b bg-popover/95 px-4 py-1.5 text-xs font-semibold text-muted-foreground backdrop-blur">{dayLabel(g.key)}</h3>
                  <ol className="divide-y">
                    {g.events.map((ev) => {
                      const amount = eventAmount(ev);
                      return (
                        <li key={ev.id} className="flex gap-3 px-4 py-3">
                          <KindIcon kind={ev.kind} tone={ev.tone} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm leading-snug font-medium">
                                <RefText ws={ctx.ws} text={ev.title} go={go} hint={ev.kind} />
                              </p>
                              {amount && <span className="shrink-0 text-sm tabular-nums">{amount}</span>}
                            </div>
                            {ev.detail && (
                              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                                <RefText ws={ctx.ws} text={ev.detail} go={go} hint={ev.kind} />
                              </p>
                            )}
                            <p className="mt-1 text-xs text-muted-foreground">
                              {new Date(ev.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · {ev.actor}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))}
              {filter === "all" && !q && <p className="px-4 py-6 text-center text-xs text-muted-foreground">Start of this vehicle's history</p>}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── All actions sheet ──────────────────────────────────────────────────────

function AllActionsSheet({ ctx, byGroup, open, onOpenChange }: { ctx: Ctx; byGroup: ReturnType<typeof useVehicleActions>["byGroup"]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const isMobile = useIsMobile();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className={cn("gap-0", isMobile ? "max-h-[90dvh] rounded-t-xl" : "sm:max-w-md")}>
        <SheetHeader className="border-b pr-12">
          <SheetTitle>All actions</SheetTitle>
          <SheetDescription>
            Everything you can do on {ctx.ws.vehicle.code} as {ROLE_LABELS[ctx.role].toLowerCase()}.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {byGroup.map((g) => (
            <section key={g.group} aria-label={g.group} className="pt-3">
              <h3 className="px-4 pb-1 text-xs font-semibold text-muted-foreground">{g.group}</h3>
              <ul>
                {g.actions.map((a) => {
                  const tile = tileFor(a.key, ctx);
                  const Icon = a.icon;
                  if (tile?.blocked) {
                    return (
                      <li key={a.key} aria-disabled="true" className="flex items-start gap-3 px-4 py-2.5 opacity-80">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
                          <Icon className="size-[18px]" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-muted-foreground">{a.label}</span>
                          <span className="block text-xs text-muted-foreground">{tile.blocked.reason}</span>
                        </span>
                        <Lock className="mt-1 size-4 shrink-0 text-muted-foreground" aria-label="Not available yet" />
                      </li>
                    );
                  }
                  return (
                    <li key={a.key}>
                      <button
                        type="button"
                        onClick={() => ctx.act(a.key, tile?.ref ?? null)}
                        className="group flex min-h-14 w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <Icon className="size-[18px]" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{a.label}</span>
                          <span className="line-clamp-2 block text-xs leading-snug text-muted-foreground">{a.description}</span>
                        </span>
                        <ChevronRight className="mt-2.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Record detail sheet ────────────────────────────────────────────────────

interface RecordState {
  stack: Target[];
  fromHistory: boolean;
}

function recordHeading(ws: VehicleWorkspace, t: Target): { icon: LucideIcon; title: string; subtitle: string } {
  switch (t.kind) {
    case "wo": {
      const wo = ws.workOrders.find((w) => w.ref === t.ref);
      return { icon: Wrench, title: t.ref, subtitle: wo?.title ?? "Work order" };
    }
    case "issue": {
      const issue = ws.issues.find((i) => i.ref === t.ref);
      return { icon: TriangleAlert, title: t.ref, subtitle: issue?.title ?? "Reported problem" };
    }
    case "entry": {
      const e = ws.entries.find((x) => x.number === t.ref);
      return { icon: e?.direction === "REVENUE" ? CircleDollarSign : Receipt, title: t.ref, subtitle: e ? `${e.category}${e.counterparty ? ` · ${e.counterparty}` : ""}` : "Entry" };
    }
    case "doc": {
      const doc = ws.documents.find((x) => x.id === t.ref);
      return { icon: FileText, title: doc ? docName(doc) : "Document", subtitle: doc?.number ?? "No number" };
    }
    case "trip": {
      const trip = ws.trips.find((x) => x.number === t.ref);
      return { icon: Route, title: t.ref, subtitle: trip ? `${trip.from} → ${trip.to}` : "Trip" };
    }
    case "workorders":
      return { icon: Wrench, title: "Work orders", subtitle: `All work orders on ${ws.vehicle.code}` };
    case "docs":
      return { icon: FileText, title: "Documents", subtitle: `Papers for ${ws.vehicle.code}; renewals keep the old version` };
    case "money":
      return { icon: Wallet, title: `Money · ${ws.money.periodLabel}`, subtitle: "This truck's share of each entry" };
  }
}

function RecordSheet({ ctx, state, onChange, onBackToHistory }: { ctx: Ctx; state: RecordState | null; onChange: (s: RecordState | null) => void; onBackToHistory: () => void }) {
  const isMobile = useIsMobile();
  const top = state?.stack[state.stack.length - 1] ?? null;
  const go = (t: Target) => state && onChange({ ...state, stack: [...state.stack, t] });
  const canBack = state !== null && (state.stack.length > 1 || state.fromHistory);
  const back = () => {
    if (!state) return;
    if (state.stack.length > 1) onChange({ ...state, stack: state.stack.slice(0, -1) });
    else onBackToHistory();
  };
  const prev = state && state.stack.length > 1 ? state.stack[state.stack.length - 2] : null;
  const heading = top ? recordHeading(ctx.ws, top) : null;
  const HeadingIcon = heading?.icon ?? FileText;
  return (
    <Sheet open={state !== null} onOpenChange={(o) => !o && onChange(null)}>
      <SheetContent side={isMobile ? "bottom" : "right"} className={cn("gap-0", isMobile ? "max-h-[90dvh] rounded-t-xl" : "sm:max-w-md")}>
        {top && heading && (
          <>
            <SheetHeader className="border-b pr-12">
              {canBack && (
                <button type="button" onClick={back} className="mb-1 inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <ChevronLeft className="size-3.5" aria-hidden />
                  {prev ? `Back to ${recordHeading(ctx.ws, prev).title}` : "Back to full history"}
                </button>
              )}
              <SheetTitle className="flex items-center gap-2 tabular-nums">
                <HeadingIcon className="size-4" aria-hidden />
                {heading.title}
              </SheetTitle>
              <SheetDescription>{heading.subtitle}</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid grid-cols-1 gap-5 p-4 pb-8">
                <RecordBody ctx={ctx} target={top} go={go} />
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function RecordBody({ ctx, target, go }: { ctx: Ctx; target: Target; go: (t: Target) => void }) {
  const { ws } = ctx;
  switch (target.kind) {
    case "wo": {
      const wo = ws.workOrders.find((w) => w.ref === target.ref);
      return wo ? <WorkOrderDetail ctx={ctx} wo={wo} go={go} /> : <Missing />;
    }
    case "issue": {
      const issue = ws.issues.find((i) => i.ref === target.ref);
      return issue ? <IssueDetail ctx={ctx} issue={issue} go={go} /> : <Missing />;
    }
    case "entry": {
      const entry = ws.entries.find((e) => e.number === target.ref);
      return entry ? <EntryDetail ctx={ctx} entry={entry} go={go} /> : <Missing />;
    }
    case "doc": {
      const doc = ws.documents.find((x) => x.id === target.ref);
      return doc ? <DocumentDetail ctx={ctx} doc={doc} /> : <Missing />;
    }
    case "trip":
      return <TripDetail ctx={ctx} number={target.ref} go={go} />;
    case "workorders":
      return <WorkOrderList ctx={ctx} go={go} />;
    case "docs":
      return <DocumentList ctx={ctx} go={go} />;
    case "money":
      return <MoneyDetail ctx={ctx} go={go} />;
  }
}

function Missing() {
  return <p className="text-sm text-muted-foreground">This record is not in the sample data.</p>;
}

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0">{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Block({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** Undo-type actions stay reachable but never compete with the main one. */
const QUIET_ACTIONS: ReadonlySet<ActionKey> = new Set(["cancel-work-order", "reverse-entry"]);

function RecordActions({ ctx, items }: { ctx: Ctx; items: Array<{ key: ActionKey; ref: string | null; label?: string }> }) {
  const allowed = items.filter((i) => ctx.can(i.key));
  if (allowed.length === 0) {
    return ctx.readOnly ? (
      <p className="flex items-center gap-1.5 border-t pt-4 text-xs text-muted-foreground">
        <Eye className="size-3.5" aria-hidden />
        Read-only view
      </p>
    ) : null;
  }
  return (
    <div className="grid grid-cols-1 gap-2 border-t pt-4">
      {allowed.map((i, idx) => {
        const a = actionByKey(i.key);
        const Icon = a.icon;
        return (
          <Button
            key={i.key}
            variant={idx === 0 ? "default" : QUIET_ACTIONS.has(i.key) ? "ghost" : "outline"}
            className={cn("h-11 justify-start gap-2 px-3 text-sm", idx > 0 && QUIET_ACTIONS.has(i.key) && "text-destructive hover:text-destructive")}
            onClick={() => ctx.act(i.key, i.ref)}
          >
            <Icon aria-hidden />
            {i.label ?? a.label}
          </Button>
        );
      })}
    </div>
  );
}

function RefLink({ onGo, children }: { onGo: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onGo} className="font-medium tabular-nums underline decoration-current/30 underline-offset-2 hover:decoration-current">
      {children}
    </button>
  );
}

function Ref({ ws, code, go, hint, children }: { ws: VehicleWorkspace; code: string; go: (t: Target) => void; hint?: TimelineKind; children?: ReactNode }) {
  const t = resolveRef(ws, code, hint);
  if (!t) return <span className="tabular-nums">{children ?? code}</span>;
  return <RefLink onGo={() => go(t)}>{children ?? code}</RefLink>;
}

function RefText({ ws, text, go, hint }: { ws: VehicleWorkspace; text: string; go: (t: Target) => void; hint?: TimelineKind }) {
  const pattern = refPattern(ws);
  if (!pattern) return <>{text}</>;
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Ref key={i} ws={ws} code={part} go={go} {...(hint ? { hint } : {})} />
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function StatusLabel({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-xs font-medium whitespace-nowrap", TONE_SOFT[tone])}>{children}</span>;
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-sm bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <span className="block h-full rounded-sm bg-sky-500" style={{ width: `${pct}%` }} />
    </span>
  );
}

function WorkOrderDetail({ ctx, wo, go }: { ctx: Ctx; wo: WorkOrder; go: (t: Target) => void }) {
  const { ws, d } = ctx;
  const s = steps(wo);
  const recorded = wo.costLines.reduce((sum, c) => sum + c.amountMinor, 0);
  const isGrounding = d.groundingWo?.ref === wo.ref;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusLabel tone={WO_TONE[wo.status]}>{WORK_ORDER_STATUS_LABELS[wo.status]}</StatusLabel>
        {wo.safetyCritical && <StatusLabel tone="critical">Safety-critical</StatusLabel>}
        {isGrounding && <StatusLabel tone="critical">Keeps the truck grounded</StatusLabel>}
      </div>
      <Facts
        rows={[
          ["From problem", wo.issueRef ? <Ref ws={ws} code={wo.issueRef} go={go} /> : <span className="text-muted-foreground">None, planned work</span>],
          ["Assigned to", wo.assignee],
          ["Opened", `${formatDate(wo.createdAt)} by ${wo.createdBy}`],
          ...(wo.dueBy ? ([["Due", `${formatDate(wo.dueBy)} (${dueLabel(wo.dueBy)})`]] as Array<[string, ReactNode]>) : []),
          ["Expected cost", wo.expectedCostMinor === null ? "Not set" : <span className="tabular-nums">{formatXaf(wo.expectedCostMinor)}</span>],
          ...(wo.actualCostMinor !== null ? ([["Actual cost", <span className="tabular-nums">{formatXaf(wo.actualCostMinor)}</span>]] as Array<[string, ReactNode]>) : []),
          ...(wo.completedAt ? ([["Completed", `${formatDate(wo.completedAt)} by ${wo.completedBy ?? "unknown"}`]] as Array<[string, ReactNode]>) : []),
        ]}
      />
      {wo.summary && (
        <Block title="What was done">
          <p className="text-sm">{wo.summary}</p>
        </Block>
      )}
      {s.total > 0 && (
        <Block title="Checklist" aside={<span className="text-xs text-muted-foreground tabular-nums">{s.done} of {s.total} done</span>}>
          <Progress done={s.done} total={s.total} />
          <ul className="mt-1 grid gap-2">
            {wo.checklist.map((c) => (
              <li key={c.label} className="flex items-start gap-2 text-sm">
                {c.done ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Done" />
                ) : (
                  <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Not done" />
                )}
                <span className={cn(c.done && "text-muted-foreground")}>{c.label}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}
      <Block title="Costs on this order" aside={wo.costLines.length > 0 ? <span className="text-xs tabular-nums">{formatXaf(recorded)}</span> : null}>
        {wo.costLines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No costs recorded yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {wo.costLines.map((line) => (
              <li key={line.label} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block">{line.label}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    {line.kind}
                    <span aria-hidden>·</span>
                    {line.entryNumber ? <Ref ws={ws} code={line.entryNumber} go={go} /> : <span>not yet an entry</span>}
                    {line.entryStatus && <StatusLabel tone={ENTRY_TONE[line.entryStatus]}>{ENTRY_STATUS_LABELS[line.entryStatus]}</StatusLabel>}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{formatXaf(line.amountMinor)}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <RecordActions
        ctx={ctx}
        items={[
          ...(wo.status === "OPEN" ? [{ key: "complete-work-order" as const, ref: wo.ref }] : []),
          ...(wo.status === "OPEN" ? [{ key: "record-expense" as const, ref: woOption(wo), label: "Record parts or a cost" }] : []),
          ...(wo.status === "SUBMITTED" ? [{ key: "approve-work-order" as const, ref: wo.ref }] : []),
          ...(wo.status === "PENDING_CLOSE" ? [{ key: "approve-closure" as const, ref: wo.ref }] : []),
          ...(wo.status === "CLOSED" && isGrounding ? [{ key: "release-to-service" as const, ref: wo.ref }] : []),
          ...(wo.status === "OPEN" || wo.status === "SUBMITTED" ? [{ key: "cancel-work-order" as const, ref: wo.ref }] : []),
        ]}
      />
    </>
  );
}

function IssueDetail({ ctx, issue, go }: { ctx: Ctx; issue: Issue; go: (t: Target) => void }) {
  const { ws } = ctx;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusLabel tone={ISSUE_TONE[issue.status]}>{ISSUE_STATUS_LABELS[issue.status]}</StatusLabel>
        {issue.safetyCritical && <StatusLabel tone="critical">Safety-critical: grounds the truck</StatusLabel>}
      </div>
      <p className="text-sm">{issue.description}</p>
      <Facts
        rows={[
          ["Category", issue.category],
          ["Reported", `${formatDateTime(issue.reportedAt)} by ${issue.reportedBy}`],
          ["Photos", issue.photos === 0 ? "None" : `${issue.photos}`],
          ["Work order", issue.workOrderRef ? <Ref ws={ws} code={issue.workOrderRef} go={go} /> : <span className="text-muted-foreground">Not planned yet</span>],
        ]}
      />
      <RecordActions ctx={ctx} items={issue.workOrderRef === null && issue.status === "OPEN" ? [{ key: "create-work-order", ref: issueOption(issue), label: "Plan a work order for it" }] : []} />
    </>
  );
}

function EntryDetail({ ctx, entry, go }: { ctx: Ctx; entry: MoneyEntry; go: (t: Target) => void }) {
  const { ws } = ctx;
  const shared = entry.entryTotalMinor !== entry.amountMinor;
  return (
    <>
      <div>
        <p className="text-2xl font-semibold tabular-nums">{formatXaf(entry.amountMinor, { signed: entry.direction === "REVENUE" })}</p>
        <p className="text-xs text-muted-foreground">
          {shared ? `This truck's share of a ${formatXaf(entry.entryTotalMinor)} entry` : entry.direction === "REVENUE" ? "Revenue" : "Expense"}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusLabel tone={ENTRY_TONE[entry.status]}>{ENTRY_STATUS_LABELS[entry.status]}</StatusLabel>
        {entry.evidence === "MISSING" ? <StatusLabel tone="warning">No receipt</StatusLabel> : <StatusLabel tone="neutral">Receipt attached</StatusLabel>}
      </div>
      <Facts
        rows={[
          ["Economic date", formatDate(entry.economicDate)],
          ["Category", `${entry.category} · ${entry.layer.toLowerCase()} cost`],
          ["Counterparty", entry.counterparty ?? <span className="text-muted-foreground">Not recorded</span>],
          ["Recorded by", entry.recordedBy],
          ["Linked to", entry.link ? <Ref ws={ws} code={entry.link.ref} go={go} hint={entry.link.kind === "TRIP" ? "TRIP" : "EXPENSE"} /> : <span className="text-muted-foreground">Nothing</span>],
        ]}
      />
      {entry.status === "POSTED" && <p className="text-xs text-muted-foreground">Posted means approved into the books. It does not mean paid.</p>}
      <RecordActions
        ctx={ctx}
        items={[
          ...(entry.status === "SUBMITTED" ? [{ key: "review-entry" as const, ref: entry.number }] : []),
          ...(entry.evidence === "MISSING" ? [{ key: "attach-receipt" as const, ref: entry.number }] : []),
          ...(entry.status === "POSTED" ? [{ key: "reverse-entry" as const, ref: entry.number }] : []),
        ]}
      />
    </>
  );
}

function DocumentDetail({ ctx, doc }: { ctx: Ctx; doc: VehicleDocument }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusLabel tone={DOC_TONE[doc.state]}>{docStateLabel(doc)}</StatusLabel>
      </div>
      {doc.state === "EXPIRED" && <p className="text-sm text-red-700 dark:text-red-300">The truck cannot legally run on this document until it is renewed.</p>}
      <Facts
        rows={[
          ["Type", doc.type],
          ["Number", doc.number ?? <span className="text-muted-foreground">Not recorded</span>],
          ["Issued", doc.issuedAt ? formatDate(doc.issuedAt) : <span className="text-muted-foreground">Unknown</span>],
          ["Expires", doc.expiresAt ? formatDate(doc.expiresAt) : "No expiry"],
          ["File", doc.hasFile ? "Scan attached" : <span className="text-amber-700 dark:text-amber-300">No scan on file</span>],
          ["Earlier versions", doc.previousVersions === 0 ? "None" : `${doc.previousVersions} kept`],
        ]}
      />
      <RecordActions ctx={ctx} items={doc.state === "NO_EXPIRY" ? [] : [{ key: "renew-document", ref: doc.id }]} />
    </>
  );
}

function TripDetail({ ctx, number, go }: { ctx: Ctx; number: string; go: (t: Target) => void }) {
  const { ws } = ctx;
  const trip = ws.trips.find((t) => t.number === number);
  if (!trip) return <Missing />;
  const linked = ws.entries.filter((e) => e.link?.kind === "TRIP" && e.link.ref === trip.number);
  const tripReadings = ws.readings.filter((r) => (r.source === "Trip start" || r.source === "Trip end") && r.observedAt >= trip.startedAt && (!trip.endedAt || r.observedAt <= trip.endedAt));
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusLabel tone={trip.status === "OPEN" ? "info" : "neutral"}>{trip.status === "OPEN" ? "Open" : "Closed"}</StatusLabel>
        {trip.exceptions > 0 && <StatusLabel tone="warning">{trip.exceptions} missing items</StatusLabel>}
      </div>
      <Facts
        rows={[
          ["Type", trip.type],
          ["Customer", trip.customer ?? <span className="text-muted-foreground">None</span>],
          ["Driver", trip.driver],
          ["Started", formatDateTime(trip.startedAt)],
          ["Ended", trip.endedAt ? formatDateTime(trip.endedAt) : <span className="text-muted-foreground">Still open</span>],
          ["Distance", trip.distanceKm === null ? <span className="text-muted-foreground">No end reading</span> : km(trip.distanceKm)],
        ]}
      />
      {tripReadings.length > 0 && (
        <Block title="Odometer">
          <ul className="grid gap-1 text-sm">
            {tripReadings.map((r) => (
              <li key={r.id} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{r.source}</span>
                <span className="tabular-nums">{km(r.valueKm)}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}
      <Block title="Money linked to this trip">
        {linked.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded against this trip.</p>
        ) : (
          <EntryList ctx={ctx} entries={linked} go={go} />
        )}
      </Block>
      <RecordActions
        ctx={ctx}
        items={
          trip.status === "OPEN" || daysFromToday(trip.endedAt ?? trip.startedAt) > -8
            ? [
                { key: "log-fuel", ref: null },
                { key: "record-expense", ref: `${trip.number} · trip`, label: "Record a cost on this trip" },
              ]
            : []
        }
      />
    </>
  );
}

function EntryList({ ctx, entries, go }: { ctx: Ctx; entries: MoneyEntry[]; go: (t: Target) => void }) {
  return (
    <ul className="divide-y rounded-lg border">
      {entries.map((e) => (
        <li key={e.id}>
          <button type="button" onClick={() => go({ kind: "entry", ref: e.number })} className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/50">
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {e.category}
                {e.counterparty ? <span className="text-muted-foreground"> · {e.counterparty}</span> : null}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="tabular-nums">{e.number}</span>
                {e.status !== "POSTED" && <StatusLabel tone={ENTRY_TONE[e.status]}>{ENTRY_STATUS_LABELS[e.status]}</StatusLabel>}
                {e.evidence === "MISSING" && <StatusLabel tone="warning">No receipt</StatusLabel>}
              </span>
            </span>
            <span className={cn("shrink-0 tabular-nums", e.direction === "REVENUE" && "text-emerald-700 dark:text-emerald-300")}>
              {formatXaf(e.amountMinor, { signed: e.direction === "REVENUE" })}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function WorkOrderList({ ctx, go }: { ctx: Ctx; go: (t: Target) => void }) {
  const open = ctx.ws.workOrders.filter((w) => w.status !== "CLOSED" && w.status !== "CANCELLED");
  const done = ctx.ws.workOrders.filter((w) => w.status === "CLOSED" || w.status === "CANCELLED");
  const list = (items: WorkOrder[]) => (
    <ul className="divide-y rounded-lg border">
      {items.map((wo) => (
        <li key={wo.id}>
          <button type="button" onClick={() => go({ kind: "wo", ref: wo.ref })} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/50">
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold tabular-nums">{wo.ref}</span>
                <StatusLabel tone={WO_TONE[wo.status]}>{WORK_ORDER_STATUS_LABELS[wo.status]}</StatusLabel>
              </span>
              <span className="block truncate text-sm">{wo.title}</span>
              <span className="block text-xs text-muted-foreground">
                {wo.assignee}
                {wo.checklist.length > 0 ? ` · ${stepsLabel(wo)}` : ""}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <Block title={`Open (${open.length})`}>{open.length === 0 ? <p className="text-sm text-muted-foreground">No open work orders.</p> : list(open)}</Block>
      {done.length > 0 && <Block title={`Closed or cancelled (${done.length})`}>{list(done)}</Block>}
      <RecordActions ctx={ctx} items={[{ key: "create-work-order", ref: ctx.d.issueWithoutWo ? issueOption(ctx.d.issueWithoutWo) : null }]} />
    </>
  );
}

function DocumentList({ ctx, go }: { ctx: Ctx; go: (t: Target) => void }) {
  const order: Record<DocumentState, number> = { EXPIRED: 0, EXPIRING: 1, VALID: 2, NO_EXPIRY: 3 };
  const docs = [...ctx.ws.documents].sort((a, b) => order[a.state] - order[b.state]);
  return (
    <>
      <ul className="divide-y rounded-lg border">
        {docs.map((doc) => (
          <li key={doc.id}>
            <button type="button" onClick={() => go({ kind: "doc", ref: doc.id })} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted/50">
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{docName(doc)}</span>
                <span className="block truncate text-xs text-muted-foreground tabular-nums">{doc.number ?? "No number"}</span>
              </span>
              <StatusLabel tone={DOC_TONE[doc.state]}>{docStateLabel(doc)}</StatusLabel>
            </button>
          </li>
        ))}
      </ul>
      <RecordActions ctx={ctx} items={[{ key: "add-document", ref: null }]} />
    </>
  );
}

function MoneyDetail({ ctx, go }: { ctx: Ctx; go: (t: Target) => void }) {
  const { ws, d } = ctx;
  const m = ws.money;
  const inPeriod = ws.entries.filter((e) => e.economicDate.startsWith(m.period)).sort((a, b) => b.economicDate.localeCompare(a.economicDate));
  return (
    <>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
        <div className="bg-popover p-3">
          <div className="text-xs text-muted-foreground">Posted expenses</div>
          <div className="text-lg font-semibold tabular-nums">{formatXaf(m.postedExpenseMinor)}</div>
          <div className="text-xs text-muted-foreground">All layers, this truck's share</div>
        </div>
        <div className="bg-popover p-3">
          <div className="text-xs text-muted-foreground">Awaiting review</div>
          <div className="text-lg font-semibold text-amber-700 tabular-nums dark:text-amber-300">{formatXaf(m.pendingReviewMinor)}</div>
          <div className="text-xs text-muted-foreground">Separate, never added to posted</div>
        </div>
      </div>
      {d.missingReceipts.length > 0 && (
        <p className="flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          {d.missingReceipts.length} {d.missingReceipts.length === 1 ? "entry has" : "entries have"} no receipt
        </p>
      )}
      <Block title={`Entries in ${m.periodLabel} (economic date)`}>
        <EntryList ctx={ctx} entries={inPeriod} go={go} />
      </Block>
      {m.costPerKm && (
        <Block title="Cost per km">
          <p className="text-sm">
            <span className="font-semibold tabular-nums">{formatXaf(m.costPerKm.minor)}/km</span>
            <span className="block text-xs text-muted-foreground">{m.costPerKm.basis}</span>
          </p>
        </Block>
      )}
      <Block title="Since the truck was registered">
        <Facts
          rows={[
            ["Revenue", <span className="tabular-nums">{formatXaf(ws.money.lifetime.revenueMinor)}</span>],
            ["Expenses", <span className="tabular-nums">{formatXaf(ws.money.lifetime.expenseMinor)}</span>],
            ["Net", <span className="font-medium tabular-nums">{formatXaf(ws.money.lifetime.netMinor, { signed: true })}</span>],
          ]}
        />
      </Block>
      <RecordActions
        ctx={ctx}
        items={[
          ...(d.awaitingReview[0] ? [{ key: "review-entry" as const, ref: d.awaitingReview[0].number, label: "Review what is waiting" }] : []),
          { key: "record-expense", ref: null },
        ]}
      />
    </>
  );
}

// ─── Shared bits ────────────────────────────────────────────────────────────

function SectionTitle({ id, children, aside }: { id?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 px-1">
      <h2 id={id} className="text-[15px] leading-tight font-semibold tracking-tight">
        {children}
      </h2>
      {aside}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function VariantD({ ws }: { ws: VehicleWorkspace }) {
  const actions = useVehicleActions(ws);
  const d = derive(ws);
  const [allOpen, setAllOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [record, setRecord] = useState<RecordState | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilterId>("all");

  const ctx: Ctx = {
    ws,
    d,
    role: actions.role,
    readOnly: actions.role === "EXECUTIVE_VIEWER",
    can: actions.can,
    act: (key, ref = null) => {
      const fromHistory = historyOpen;
      setAllOpen(false);
      setHistoryOpen(false);
      if (key === "open-work-order") {
        const woRef = ref ?? d.inProgress?.ref ?? null;
        setRecord(woRef ? { stack: [{ kind: "wo", ref: woRef }], fromHistory } : null);
        return;
      }
      setRecord(null);
      actions.open(key, ref);
    },
    show: (target) => {
      const fromHistory = historyOpen;
      setAllOpen(false);
      setHistoryOpen(false);
      setRecord({ stack: [target], fromHistory });
    },
  };

  return (
    <div className="@container mx-auto w-full max-w-[1200px] px-4 pt-4 pb-28 md:px-6 md:pt-6">
      <div className="grid grid-cols-1 items-start gap-5 @4xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] @4xl:gap-6">
        <div className="grid min-w-0 grid-cols-1 gap-5 @4xl:gap-6">
          <IdentityCard ctx={ctx} />
          {ctx.readOnly ? <CostSummary ctx={ctx} /> : <ActionGrid ctx={ctx} total={actions.available.length} onAll={() => setAllOpen(true)} />}
          <NeedsYou ctx={ctx} />
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-5 @4xl:gap-6">
          <RightNow ctx={ctx} />
          <RecentHistory ctx={ctx} onFull={() => setHistoryOpen(true)} />
        </div>
      </div>

      <AllActionsSheet ctx={ctx} byGroup={actions.byGroup} open={allOpen} onOpenChange={setAllOpen} />
      <HistorySheet
        ctx={ctx}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        query={historyQuery}
        onQuery={setHistoryQuery}
        filter={historyFilter}
        onFilter={setHistoryFilter}
      />
      <RecordSheet
        ctx={ctx}
        state={record}
        onChange={setRecord}
        onBackToHistory={() => {
          setRecord(null);
          setHistoryOpen(true);
        }}
      />
      {actions.sheet}
    </div>
  );
}
