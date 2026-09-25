// PROTOTYPE — throwaway, issue #44. Variant C "Workshop board": readiness
// first. This vehicle's problems and work orders move across lanes; money,
// documents, trips and history sit behind the board.

import { Fragment, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDollarSign,
  CircleHelp,
  ClipboardCheck,
  Coins,
  Eye,
  FileText,
  FileWarning,
  Flag,
  Gauge,
  LayoutList,
  OctagonX,
  Plus,
  Receipt,
  Route,
  ShieldAlert,
  ShieldCheck,
  StickyNote,
  TrendingUp,
  TriangleAlert,
  Undo2,
  UserRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { actionByKey, useVehicleActions, type ActionGroup, type ActionKey } from "./actions.js";
import {
  ENTRY_STATUS_LABELS,
  ISSUE_STATUS_LABELS,
  TODAY,
  WORK_ORDER_STATUS_LABELS,
  formatDate,
  formatDateTime,
  formatXaf,
  relativeDays,
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

/* ------------------------------------------------------------------ types */

type Actions = ReturnType<typeof useVehicleActions>;

type DetailRef =
  | { kind: "workOrder"; ref: string }
  | { kind: "issue"; ref: string }
  | { kind: "entry"; ref: string }
  | { kind: "trip"; ref: string }
  | { kind: "document"; ref: string };

interface Ctx {
  ws: VehicleWorkspace;
  actions: Actions;
  show: (d: DetailRef) => void;
  checklists: Record<string, boolean[]>;
  toggle: (woRef: string, index: number) => void;
}

type ButtonVariant = "default" | "outline" | "secondary" | "ghost";
type ButtonSize = "default" | "xs" | "sm" | "lg";

/* ---------------------------------------------------------------- helpers */

const TONE = {
  critical: "bg-red-500/10 text-red-700 dark:text-red-300",
  warning: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  info: "bg-sky-500/10 text-sky-800 dark:text-sky-300",
  neutral: "bg-muted text-muted-foreground",
} as const;
type Tone = keyof typeof TONE;

const WO_TONE: Record<WorkOrderStatus, Tone> = {
  SUBMITTED: "warning",
  OPEN: "info",
  PENDING_CLOSE: "warning",
  CLOSED: "success",
  CANCELLED: "neutral",
};
const ENTRY_TONE: Record<EntryStatus, Tone> = { POSTED: "success", SUBMITTED: "warning", REJECTED: "critical", REVERSED: "neutral" };
const ISSUE_TONE: Record<IssueStatus, Tone> = { OPEN: "warning", IN_WORK: "info", RESOLVED: "success", DISMISSED: "neutral" };
const LAYER_LABELS: Record<MoneyEntry["layer"], string> = {
  DIRECT: "Direct",
  MAINTENANCE: "Maintenance",
  OWNERSHIP: "Ownership",
  SHARED: "Shared",
};

const KIND_META: Record<TimelineKind, { label: string; icon: LucideIcon }> = {
  ISSUE: { label: "Problems", icon: TriangleAlert },
  GROUNDED: { label: "Grounding", icon: OctagonX },
  WORK_ORDER: { label: "Work orders", icon: Wrench },
  RELEASED: { label: "Releases", icon: ShieldCheck },
  EXPENSE: { label: "Expenses", icon: Receipt },
  REVENUE: { label: "Revenue", icon: CircleDollarSign },
  APPROVAL: { label: "Approvals", icon: BadgeCheck },
  REVERSAL: { label: "Reversals", icon: Undo2 },
  TRIP: { label: "Trips", icon: Route },
  READING: { label: "Readings", icon: Gauge },
  DOCUMENT: { label: "Documents", icon: FileText },
  ASSIGNMENT: { label: "Assignments", icon: UserRound },
  LIFECYCLE: { label: "Lifecycle", icon: Flag },
  NOTE: { label: "Notes", icon: StickyNote },
};

const EVENT_TONE: Record<TimelineEvent["tone"], string> = {
  neutral: "bg-muted text-muted-foreground",
  critical: TONE.critical,
  warning: TONE.warning,
  success: TONE.success,
};

const DAY_MS = 86_400_000;

/** Whole days from today; negative is in the past. */
function dayOffset(iso: string): number {
  return Math.round((Date.parse(`${iso.slice(0, 10)}T12:00:00`) - Date.parse(`${TODAY}T12:00:00`)) / DAY_MS);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

function shortDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function km(n: number): string {
  return `${n.toLocaleString("en-US")} km`;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
}

function docName(d: VehicleDocument): string {
  return d.type.replace(/\s*\(.*\)\s*$/, "");
}

function personName(person: string): string {
  return person.replace(/\s*\(.*\)$/, "");
}

function vehicleName(ws: VehicleWorkspace): string {
  const v = ws.vehicle;
  if (v.displayName !== v.code) return v.displayName;
  return [v.make, v.model].filter(Boolean).join(" ");
}

function lifecycleLabel(status: string): string {
  const text = status.toLowerCase().replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dueText(iso: string): { text: string; tone: Tone } {
  const d = dayOffset(iso);
  if (d < 0) return { text: `${plural(-d, "day")} overdue`, tone: "critical" };
  if (d === 0) return { text: "Due today", tone: "warning" };
  if (d === 1) return { text: "Due tomorrow", tone: "warning" };
  return { text: `Due in ${d} days`, tone: "neutral" };
}

function docStatus(d: VehicleDocument): { label: string; tone: Tone } {
  switch (d.state) {
    case "EXPIRED":
      return { label: "Expired", tone: "critical" };
    case "EXPIRING":
      return { label: d.daysLeft === null ? "Expiring" : `${plural(d.daysLeft, "day")} left`, tone: "warning" };
    case "VALID":
      return { label: "Valid", tone: "success" };
    case "NO_EXPIRY":
      return { label: "No expiry", tone: "neutral" };
  }
}

function progress(wo: WorkOrder, checklists: Record<string, boolean[]>): { done: number; total: number } {
  const list = checklists[wo.ref] ?? wo.checklist.map((c) => c.done);
  return { done: list.filter(Boolean).length, total: wo.checklist.length };
}

function resolvable(ws: VehicleWorkspace, d: DetailRef): boolean {
  switch (d.kind) {
    case "workOrder":
      return ws.workOrders.some((w) => w.ref === d.ref);
    case "issue":
      return ws.issues.some((i) => i.ref === d.ref);
    case "entry":
      return ws.entries.some((e) => e.number === d.ref);
    case "trip":
      return ws.trips.some((t) => t.number === d.ref);
    case "document":
      return ws.documents.some((x) => x.id === d.ref);
  }
}

function refLabel(ws: VehicleWorkspace, d: DetailRef): string {
  if (d.kind !== "document") return d.ref;
  const doc = ws.documents.find((x) => x.id === d.ref);
  return doc ? (doc.number ?? docName(doc)) : d.ref;
}

function eventTarget(ev: TimelineEvent): DetailRef | null {
  if (!ev.ref) return null;
  switch (ev.kind) {
    case "ISSUE":
    case "GROUNDED":
      return { kind: "issue", ref: ev.ref };
    case "WORK_ORDER":
    case "RELEASED":
      return { kind: "workOrder", ref: ev.ref };
    case "EXPENSE":
    case "REVENUE":
    case "APPROVAL":
    case "REVERSAL":
      return { kind: "entry", ref: ev.ref };
    case "TRIP":
      return { kind: "trip", ref: ev.ref };
    case "DOCUMENT":
      return { kind: "document", ref: ev.ref };
    default:
      return null;
  }
}

function entryLinkTarget(e: MoneyEntry): DetailRef | null {
  if (!e.link) return null;
  if (e.link.kind === "WORK_ORDER") return { kind: "workOrder", ref: e.link.ref };
  if (e.link.kind === "TRIP") return { kind: "trip", ref: e.link.ref };
  return { kind: "document", ref: e.link.ref };
}

/* ------------------------------------------------------- role and actions */

const GROUP_FIRST: Partial<Record<ProtoRole, ActionGroup>> = {
  MAINTENANCE: "Maintenance",
  FIELD_SUBMITTER: "Capture",
  FINANCE_APPROVER: "Money",
};

const PROMINENT: Record<ProtoRole, ActionKey[]> = {
  ADMIN: ["report-issue", "create-work-order"],
  OPS_MANAGER: ["report-issue", "create-work-order"],
  MAINTENANCE: ["report-issue", "create-work-order"],
  FIELD_SUBMITTER: ["log-fuel", "report-issue", "record-reading"],
  FINANCE_APPROVER: ["record-expense"],
  EXECUTIVE_VIEWER: [],
};

/** The record an action most likely applies to, so the form opens prefilled. */
function defaultRef(ws: VehicleWorkspace, key: ActionKey): string | null {
  switch (key) {
    case "complete-work-order":
    case "cancel-work-order":
      return ws.workOrders.find((w) => w.status === "OPEN")?.ref ?? null;
    case "approve-work-order":
      return ws.workOrders.find((w) => w.status === "SUBMITTED")?.ref ?? null;
    case "approve-closure":
      return ws.workOrders.find((w) => w.status === "PENDING_CLOSE")?.ref ?? null;
    case "renew-document":
      return (ws.documents.find((d) => d.state === "EXPIRED") ?? ws.documents.find((d) => d.state === "EXPIRING"))?.id ?? null;
    case "attach-receipt":
      return ws.entries.find((e) => e.evidence === "MISSING")?.number ?? null;
    case "review-entry":
      return ws.entries.find((e) => e.status === "SUBMITTED")?.number ?? null;
    case "create-work-order":
      return ws.issues.find((i) => i.status === "OPEN" && !i.workOrderRef)?.ref ?? null;
    default:
      return null;
  }
}

function orderedGroups(actions: Actions): Actions["byGroup"] {
  const first = GROUP_FIRST[actions.role];
  if (!first) return actions.byGroup;
  return [...actions.byGroup].sort((a, b) => Number(b.group === first) - Number(a.group === first));
}

/* ------------------------------------------------------------ small parts */

function Tag({ tone = "neutral", icon: Icon, children, className }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap", TONE[tone], className)}>
      {Icon && <Icon className="size-3" aria-hidden />}
      {children}
    </span>
  );
}

function RefLink({ ctx, to, children, className }: { ctx: Ctx; to: DetailRef; children?: ReactNode; className?: string }) {
  const label = children ?? refLabel(ctx.ws, to);
  if (!resolvable(ctx.ws, to)) return <span className={cn("tabular-nums", className)}>{label}</span>;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        ctx.show(to);
      }}
      className={cn(
        "relative z-10 rounded-sm font-medium whitespace-nowrap tabular-nums underline decoration-foreground/30 underline-offset-[3px] transition-colors hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      {label}
    </button>
  );
}

function ActionButton({
  ctx,
  actionKey,
  refId,
  label,
  variant = "outline",
  size = "default",
  className,
}: {
  ctx: Ctx;
  actionKey: ActionKey;
  refId?: string | null;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const action = actionByKey(actionKey);
  const Icon = action.icon;
  return (
    <Button
      variant={variant}
      size={size}
      className={cn(className)}
      onClick={() => ctx.actions.open(actionKey, refId === undefined ? defaultRef(ctx.ws, actionKey) : refId)}
    >
      <Icon data-icon="inline-start" aria-hidden />
      {label ?? action.label}
    </Button>
  );
}

function AllActionsMenu({ ctx, className }: { ctx: Ctx; className?: string }) {
  const groups = orderedGroups(ctx.actions);
  if (groups.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" className={cn(className)} />}>
        <LayoutList data-icon="inline-start" aria-hidden />
        All actions
        <ChevronDown data-icon="inline-end" className="text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {groups.map((g, i) => (
          <Fragment key={g.group}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel>{g.group}</DropdownMenuLabel>
              {g.actions.map((a) => {
                const Icon = a.icon;
                return (
                  <DropdownMenuItem key={a.key} onClick={() => ctx.actions.open(a.key, defaultRef(ctx.ws, a.key))}>
                    <Icon aria-hidden />
                    <span className="flex-1">{a.label}</span>
                    {a.status === "new" && <span className="text-[11px] font-medium text-sky-700 dark:text-sky-300">New</span>}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Fact({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{value}</dd>
      {sub ? <dd className="truncate text-xs text-muted-foreground">{sub}</dd> : null}
    </div>
  );
}

function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max <= 0 ? 0 : Math.max(2, Math.min(100, Math.round((value / max) * 100)));
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <span className={cn("block h-full rounded-full bg-foreground/55", className)} style={{ width: `${pct}%` }} />
    </span>
  );
}

/* ================================================================== page */

export function VariantC({ ws }: { ws: VehicleWorkspace }) {
  const actions = useVehicleActions(ws);
  const [trail, setTrail] = useState<DetailRef[]>([]);
  const [checklists, setChecklists] = useState<Record<string, boolean[]>>(() =>
    Object.fromEntries(ws.workOrders.map((w) => [w.ref, w.checklist.map((c) => c.done)])),
  );

  const ctx: Ctx = {
    ws,
    actions,
    show: (d) => setTrail([d]),
    checklists,
    toggle: (woRef, index) =>
      setChecklists((prev) => {
        const list = [...(prev[woRef] ?? [])];
        list[index] = !list[index];
        return { ...prev, [woRef]: list };
      }),
  };

  return (
    <div className="@container mx-auto w-full max-w-7xl px-4 pt-5 pb-28 sm:px-6">
      <WorkspaceHeader ctx={ctx} />
      <ReadinessBand ctx={ctx} />
      <IdentityFacts ws={ws} className="mt-4 @3xl:hidden" />
      <Board ctx={ctx} />
      <div className="mt-4 grid gap-4 @4xl:grid-cols-3">
        <ServiceDue ctx={ctx} />
        <WorkshopSpend ctx={ctx} />
        <Readings ctx={ctx} />
      </div>
      <Records ctx={ctx} />
      <DetailSheet ctx={ctx} trail={trail} setTrail={setTrail} />
      {actions.sheet}
    </div>
  );
}

/* ---------------------------------------------------------------- header */

function WorkspaceHeader({ ctx }: { ctx: Ctx }) {
  const { ws, actions } = ctx;
  const v = ws.vehicle;
  const prominent = PROMINENT[actions.role].filter((k) => actions.can(k));
  const readOnly = actions.available.length === 0;
  return (
    <header>
      <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-center @3xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h1 className="text-2xl font-semibold tracking-tight tabular-nums">{v.code}</h1>
            <span className="text-base text-muted-foreground">{vehicleName(ws)}</span>
          </div>
        </div>
        {readOnly ? (
          <Tag icon={Eye} className="h-7 px-2.5 text-sm">
            Read-only: you see everything, change nothing
          </Tag>
        ) : (
          <div className="grid grid-cols-2 gap-2 @3xl:flex @3xl:flex-wrap @3xl:justify-end">
            {prominent.map((k) => (
              <ActionButton key={k} ctx={ctx} actionKey={k} />
            ))}
            <AllActionsMenu ctx={ctx} className={cn(prominent.length % 2 === 0 && "col-span-2")} />
          </div>
        )}
      </div>
      <IdentityFacts ws={ws} className="mt-3 hidden @3xl:flex" />
    </header>
  );
}

function IdentityFacts({ ws, className }: { ws: VehicleWorkspace; className?: string }) {
  const v = ws.vehicle;
  const loc = ws.location;
  return (
    <dl className={cn("grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border px-4 py-3 @3xl:flex @3xl:flex-wrap @3xl:gap-x-8 @3xl:rounded-none @3xl:border-0 @3xl:p-0", className)}>
      <Fact label="Plate" value={v.plate ?? "Not recorded"} sub={v.year ? `${v.year} · ${v.classLabel}` : v.classLabel} />
      <Fact label="Lifecycle" value={lifecycleLabel(v.lifecycle)} sub={v.commissionedAt ? `since ${formatDate(v.commissionedAt)}` : "Not commissioned"} />
      <Fact label="Home branch" value={v.homeBranch.name} sub="Administrative home" />
      <Fact
        label="Custodian"
        value={ws.custodian?.name ?? "Not assigned"}
        sub={ws.custodian ? `Accountable · since ${shortDate(ws.custodian.since)}` : "No one accountable"}
      />
      <Fact
        label="Last reported at"
        value={loc.state === "REPORTED" ? loc.place : "No report"}
        sub={loc.state === "REPORTED" ? `${formatDateTime(loc.observedAt)} · ${loc.source}` : "Not tracked by GPS"}
      />
      <Fact label="Odometer" value={km(ws.meter.odometerKm)} sub={`${shortDate(ws.meter.observedAt)} · ${ws.meter.source}, ${ws.meter.observedBy}`} />
    </dl>
  );
}

/* ------------------------------------------------------------- readiness */

type StepState = "done" | "current" | "todo";

interface PathStep {
  id: string;
  title: string;
  icon: LucideIcon;
  state: StepState;
  refTo: DetailRef | null;
  detail: string;
}

interface NextMove {
  who: string;
  what: string;
  action: ActionKey;
  label: string;
  refId: string;
  open: DetailRef;
}

interface ServicePath {
  steps: PathStep[];
  next: NextMove | null;
}

/** The mechanical way back to the road, read from the grounding issue and its work order. */
function derivePath(ws: VehicleWorkspace, checklists: Record<string, boolean[]>): ServicePath | null {
  const r = ws.readiness;
  if (r.state !== "GROUNDED") return null;
  const issueTo: DetailRef = { kind: "issue", ref: r.issueRef };
  const found = r.workOrderRef ? ws.workOrders.find((w) => w.ref === r.workOrderRef) : undefined;
  const wo = found && found.status !== "CANCELLED" ? found : undefined;

  const steps: PathStep[] = [
    { id: "reported", title: "Problem reported", icon: TriangleAlert, state: "done", refTo: issueTo, detail: `on ${shortDate(r.since)} by ${personName(r.reportedBy)}` },
  ];
  let next: NextMove | null = null;

  if (!wo) {
    steps.push({ id: "work", title: "Plan the work", icon: Wrench, state: "current", refTo: null, detail: "No work order yet" });
    next = {
      who: "Workshop",
      what: `Plan the repair for ${r.issueRef}: what, who, by when and the expected cost.`,
      action: "create-work-order",
      label: "Create work order",
      refId: r.issueRef,
      open: issueTo,
    };
    steps.push({ id: "signoff", title: "Signed off", icon: ClipboardCheck, state: "todo", refTo: null, detail: "By finance, not the technician" });
    steps.push({ id: "release", title: "Released", icon: ShieldCheck, state: "todo", refTo: null, detail: "By an operations manager" });
    return { steps, next };
  }

  const woTo: DetailRef = { kind: "workOrder", ref: wo.ref };
  const { done, total } = progress(wo, checklists);

  if (wo.status === "SUBMITTED") {
    steps.push({ id: "work", title: "Awaiting authorization", icon: Wrench, state: "current", refTo: woTo, detail: "finance approves first" });
    next = {
      who: "Finance approver",
      what: `Authorize ${wo.ref}${wo.expectedCostMinor !== null ? ` (${formatXaf(wo.expectedCostMinor)} expected)` : ""} so work can start.`,
      action: "approve-work-order",
      label: "Authorize",
      refId: wo.ref,
      open: woTo,
    };
  } else if (wo.status === "OPEN") {
    const left = total - done;
    steps.push({ id: "work", title: "Work in progress", icon: Wrench, state: "current", refTo: woTo, detail: `· checklist ${done}/${total}` });
    next = {
      who: wo.assignee,
      what:
        left > 0
          ? `Finish the ${left === 1 ? "last checklist step" : `last ${left} checklist steps`} and complete ${wo.ref}.${wo.dueBy ? ` ${dueText(wo.dueBy).text}.` : ""}`
          : `Checklist done. Record what was done and the actual cost to complete ${wo.ref}.`,
      action: "complete-work-order",
      label: "Complete work",
      refId: wo.ref,
      open: woTo,
    };
  } else {
    steps.push({ id: "work", title: "Work done", icon: Wrench, state: "done", refTo: woTo, detail: wo.completedAt ? `on ${shortDate(wo.completedAt)}` : "" });
  }

  if (wo.status === "PENDING_CLOSE") {
    steps.push({ id: "signoff", title: "Awaiting sign-off", icon: ClipboardCheck, state: "current", refTo: null, detail: "Finance checks work and cost" });
    next = {
      who: "Finance approver",
      what: `Check ${wo.ref}'s work and its actual cost. ${personName(wo.completedBy ?? "The technician")} cannot sign off their own work.`,
      action: "approve-closure",
      label: "Sign off",
      refId: wo.ref,
      open: woTo,
    };
  } else if (wo.status === "CLOSED") {
    steps.push({ id: "signoff", title: "Signed off", icon: ClipboardCheck, state: "done", refTo: null, detail: "Finance approved" });
  } else {
    steps.push({ id: "signoff", title: "Signed off", icon: ClipboardCheck, state: "todo", refTo: null, detail: "By finance, not the technician" });
  }

  if (wo.status === "CLOSED") {
    steps.push({ id: "release", title: "Release to service", icon: ShieldCheck, state: "current", refTo: null, detail: "Road test, then release" });
    next = {
      who: "Operations manager",
      what: "Road-test and release to service. After a safety-critical problem, whoever did the work cannot release.",
      action: "release-to-service",
      label: "Release to service",
      refId: wo.ref,
      open: woTo,
    };
  } else {
    steps.push({ id: "release", title: "Released", icon: ShieldCheck, state: "todo", refTo: null, detail: "By an operations manager" });
  }

  return { steps, next };
}

const STATE_PANEL: Record<"critical" | "success" | "warning" | "neutral", string> = {
  critical: "bg-red-500/[0.06] dark:bg-red-500/10",
  success: "bg-emerald-500/[0.06] dark:bg-emerald-500/10",
  warning: "bg-amber-500/[0.06] dark:bg-amber-500/10",
  neutral: "bg-muted/50",
};

function ReadinessBand({ ctx }: { ctx: Ctx }) {
  const { ws } = ctx;
  const r = ws.readiness;
  const path = derivePath(ws, ctx.checklists);
  const expired = ws.documents.filter((d) => d.state === "EXPIRED");
  const expiring = ws.documents.filter((d) => d.state === "EXPIRING");
  const issue = r.state === "GROUNDED" ? ws.issues.find((i) => i.ref === r.issueRef) : undefined;
  const blockers = [...(r.state === "GROUNDED" ? [`the repair for ${r.issueRef}`] : []), ...expired.map((d) => `the expired ${docName(d).toLowerCase()}`)];
  const tone = r.state === "GROUNDED" ? "critical" : r.state === "NOT_ASSESSED" ? "neutral" : blockers.length > 0 ? "warning" : "success";

  return (
    <section aria-label="Readiness" className="mt-5 overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="grid @4xl:grid-cols-[19rem_minmax(0,1fr)]">
        <div className={cn("flex flex-col border-b p-4 @4xl:border-r @4xl:border-b-0 @4xl:p-5", STATE_PANEL[tone])}>
          <p className="text-xs font-medium text-muted-foreground">Availability</p>
          {r.state === "GROUNDED" && (
            <>
              <p className="mt-1 flex items-center gap-2 text-3xl font-semibold tracking-tight text-red-700 dark:text-red-300">
                <OctagonX className="size-7 shrink-0" aria-hidden />
                Grounded
              </p>
              <p className="mt-1 text-sm font-medium tabular-nums">
                Since {shortDate(r.since)} · {plural(Math.max(0, -dayOffset(r.since)), "day")}
              </p>
              <p className="mt-3 text-sm leading-snug">{r.reason}</p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Reported by {r.reportedBy} · <RefLink ctx={ctx} to={{ kind: "issue", ref: r.issueRef }} className="text-foreground" />
              </p>
              {issue?.safetyCritical && (
                <Tag tone="critical" icon={ShieldAlert} className="mt-2">
                  Safety-critical
                </Tag>
              )}
            </>
          )}
          {r.state === "AVAILABLE" && (
            <>
              <p className="mt-1 flex items-center gap-2 text-3xl font-semibold tracking-tight text-emerald-700 dark:text-emerald-300">
                <CircleCheck className="size-7 shrink-0" aria-hidden />
                Available
              </p>
              <p className="mt-1 text-sm font-medium">Since {shortDate(r.since)}</p>
            </>
          )}
          {r.state === "NOT_ASSESSED" && (
            <>
              <p className="mt-1 flex items-center gap-2 text-3xl font-semibold tracking-tight">
                <CircleHelp className="size-7 shrink-0 text-muted-foreground" aria-hidden />
                Not assessed
              </p>
              <p className="mt-2 text-sm text-muted-foreground">No one has confirmed whether it can work. Lifecycle alone never says it can.</p>
            </>
          )}
          {r.state !== "NOT_ASSESSED" && (
            <p className="mt-4 border-t border-foreground/10 pt-3 text-sm @4xl:mt-auto">
              <span className="font-semibold">Can {ws.vehicle.code} work today? {blockers.length > 0 ? "No." : "Yes."}</span>{" "}
              {blockers.length > 0
                ? `${blockers.length === 1 ? "One thing stands" : `${blockers.length} things stand`} in the way: ${joinAnd(blockers)}.`
                : "Nothing stands in the way."}
            </p>
          )}
        </div>
        <div className="min-w-0 p-4 @4xl:p-5">{path ? <PathToService ctx={ctx} path={path} /> : <NoGrounding ctx={ctx} />}</div>
      </div>
      {(expired.length > 0 || expiring.length > 0) && <Paperwork ctx={ctx} docs={[...expired, ...expiring]} blocking={expired.length > 0} />}
    </section>
  );
}

function StepNode({ step }: { step: PathStep }) {
  const Icon = step.state === "done" ? Check : step.icon;
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full",
        step.state === "done" && "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950",
        step.state === "current" && "bg-amber-500/15 text-amber-700 ring-2 ring-amber-500 dark:text-amber-300",
        step.state === "todo" && "border border-dashed border-foreground/25 text-muted-foreground",
      )}
    >
      <Icon className="size-4" aria-hidden />
      <span className="sr-only">{step.state === "done" ? "Done:" : step.state === "current" ? "Current step:" : "Not yet:"}</span>
    </span>
  );
}

function StepText({ ctx, step }: { ctx: Ctx; step: PathStep }) {
  return (
    <>
      <p className={cn("flex flex-wrap items-center gap-1.5 text-sm font-medium", step.state === "todo" && "text-muted-foreground")}>
        {step.title}
        {step.state === "current" && <Tag tone="warning">Now</Tag>}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {step.refTo && (
          <>
            <RefLink ctx={ctx} to={step.refTo} className="text-foreground" />{" "}
          </>
        )}
        {step.detail}
      </p>
    </>
  );
}

function PathToService({ ctx, path }: { ctx: Ctx; path: ServicePath }) {
  const { steps, next } = path;
  const canAct = next ? ctx.actions.can(next.action) : false;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">Path back to service</h2>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Wrench className="size-3.5" aria-hidden />
          Mechanical
        </span>
      </div>

      <ol className="mt-4 hidden grid-cols-4 @4xl:grid">
        {steps.map((s, i) => (
          <li key={s.id} className="min-w-0">
            <div className="flex items-center">
              <StepNode step={s} />
              {i < steps.length - 1 && (
                <span aria-hidden className={cn("mx-2 h-0.5 flex-1 rounded-full", s.state === "done" ? "bg-emerald-500/60" : "bg-border")} />
              )}
            </div>
            <div className="mt-2 pr-4">
              <StepText ctx={ctx} step={s} />
            </div>
          </li>
        ))}
      </ol>

      <ol className="mt-3 @4xl:hidden">
        {steps.map((s, i) => (
          <li key={s.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <StepNode step={s} />
              {i < steps.length - 1 && (
                <span aria-hidden className={cn("my-1 min-h-3 w-0.5 flex-1 rounded-full", s.state === "done" ? "bg-emerald-500/60" : "bg-border")} />
              )}
            </div>
            <div className={cn("min-w-0 pt-1", i < steps.length - 1 && "pb-3")}>
              <StepText ctx={ctx} step={s} />
            </div>
          </li>
        ))}
      </ol>

      {next && (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3 @2xl:flex-row @2xl:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Next move: {next.who}</p>
            <p className="mt-0.5 text-sm">{next.what}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {canAct && <ActionButton ctx={ctx} actionKey={next.action} refId={next.refId} label={next.label} variant="default" />}
            <Button variant="outline" onClick={() => ctx.show(next.open)}>
              Open {next.open.ref}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NoGrounding({ ctx }: { ctx: Ctx }) {
  const open = ctx.ws.issues.filter((i) => i.status === "OPEN" || i.status === "IN_WORK");
  return (
    <div>
      <h2 className="text-sm font-semibold">Mechanical</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Nothing mechanical is keeping it off the road.
        {open.length > 0 && ` ${plural(open.length, "open problem")} on the board below, none safety-critical.`}
      </p>
    </div>
  );
}

function Paperwork({ ctx, docs, blocking }: { ctx: Ctx; docs: VehicleDocument[]; blocking: boolean }) {
  const canRenew = ctx.actions.can("renew-document");
  return (
    <div className="grid border-t bg-muted/40 @4xl:grid-cols-[19rem_minmax(0,1fr)]">
      <div className="flex items-start gap-2 px-4 pt-3 @4xl:border-r @4xl:px-5 @4xl:py-3">
        <FileWarning className={cn("mt-0.5 size-4 shrink-0", blocking ? "text-red-600 dark:text-red-400" : "text-amber-600")} aria-hidden />
        <div>
          <p className="text-sm font-semibold">Paperwork</p>
          <p className="text-xs text-muted-foreground">{blocking ? "Also keeps it off the road, separately from the repair" : "Renewals coming up"}</p>
        </div>
      </div>
      <ul className="divide-y px-4 @4xl:px-5">
        {docs.map((d) => {
          const st = docStatus(d);
          return (
            <li key={d.id} className="flex items-center gap-3 py-2.5">
              <div className="flex min-w-0 flex-1 flex-col gap-1 @4xl:flex-row @4xl:items-center @4xl:gap-3">
                <p className="flex items-center gap-2 text-sm">
                  <Tag tone={st.tone} className="min-w-16 justify-center">
                    {st.label}
                  </Tag>
                  <RefLink ctx={ctx} to={{ kind: "document", ref: d.id }}>
                    {docName(d)}
                  </RefLink>
                </p>
                <p className="text-xs text-muted-foreground @4xl:text-sm">
                  {d.expiresAt ? (d.state === "EXPIRED" ? `Expired ${shortDate(d.expiresAt)}, it cannot legally run` : `Expires ${shortDate(d.expiresAt)}`) : "No expiry date"}
                  {d.number ? <span className="whitespace-nowrap"> · {d.number}</span> : null}
                </p>
              </div>
              {canRenew && (
                <ActionButton ctx={ctx} actionKey="renew-document" refId={d.id} label="Renew" size="sm" variant={d.state === "EXPIRED" ? "default" : "outline"} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ----------------------------------------------------------------- board */

type LaneId = "reported" | "authorization" | "progress" | "signoff" | "done";
type BoardItem = { type: "issue"; issue: Issue } | { type: "wo"; wo: WorkOrder };

interface Lane {
  id: LaneId;
  title: string;
  hint: string;
  items: BoardItem[];
  add: { key: ActionKey; label: string } | null;
  empty: string;
}

function itemDate(item: BoardItem): string {
  return item.type === "issue" ? item.issue.reportedAt : (item.wo.completedAt ?? item.wo.createdAt);
}

function itemSafety(item: BoardItem): boolean {
  return item.type === "issue" ? item.issue.safetyCritical : item.wo.safetyCritical;
}

function sortItems(items: BoardItem[]): BoardItem[] {
  return [...items].sort((a, b) => Number(itemSafety(b)) - Number(itemSafety(a)) || itemDate(b).localeCompare(itemDate(a)));
}

function buildLanes(ws: VehicleWorkspace): Lane[] {
  const wos = (statuses: WorkOrderStatus[]): BoardItem[] =>
    sortItems(ws.workOrders.filter((w) => statuses.includes(w.status)).map((wo) => ({ type: "wo", wo })));
  const recent = ws.workOrders.filter((w) => (w.status === "CLOSED" || w.status === "CANCELLED") && dayOffset(w.completedAt ?? w.createdAt) >= -60);
  return [
    {
      id: "reported",
      title: "Reported",
      hint: "No work order yet",
      items: sortItems(ws.issues.filter((i) => i.status === "OPEN" && !i.workOrderRef).map((issue) => ({ type: "issue", issue }))),
      add: { key: "report-issue", label: "Report a problem" },
      empty: "No problem is waiting for a work order.",
    },
    {
      id: "authorization",
      title: "Awaiting authorization",
      hint: "Finance approves before work",
      items: wos(["SUBMITTED"]),
      add: { key: "create-work-order", label: "Create work order" },
      empty: "Nothing waiting for finance.",
    },
    { id: "progress", title: "In progress", hint: "In the workshop", items: wos(["OPEN"]), add: null, empty: "No work in progress." },
    { id: "signoff", title: "Awaiting sign-off", hint: "Finance checks work and cost", items: wos(["PENDING_CLOSE"]), add: null, empty: "Nothing to sign off." },
    {
      id: "done",
      title: "Done",
      hint: "Last 60 days",
      items: sortItems(recent.map((wo) => ({ type: "wo", wo }))),
      add: null,
      empty: "Nothing closed in the last 60 days.",
    },
  ];
}

function cardNext(ws: VehicleWorkspace, item: BoardItem): { who: string; action: ActionKey; label: string } | null {
  if (item.type === "issue") return item.issue.status === "OPEN" ? { who: "Workshop", action: "create-work-order", label: "Create work order" } : null;
  const wo = item.wo;
  switch (wo.status) {
    case "SUBMITTED":
      return { who: "Finance", action: "approve-work-order", label: "Authorize" };
    case "OPEN":
      return { who: personName(wo.assignee), action: "complete-work-order", label: "Complete" };
    case "PENDING_CLOSE":
      return { who: "Finance", action: "approve-closure", label: "Sign off" };
    case "CLOSED":
      return ws.readiness.state === "GROUNDED" && ws.readiness.workOrderRef === wo.ref
        ? { who: "Operations manager", action: "release-to-service", label: "Release" }
        : null;
    default:
      return null;
  }
}

function Board({ ctx }: { ctx: Ctx }) {
  const lanes = buildLanes(ctx.ws);
  const [doneOpen, setDoneOpen] = useState(false);
  const [open, setOpen] = useState<Record<LaneId, boolean>>({ reported: false, authorization: false, progress: true, signoff: false, done: false });
  return (
    <section aria-labelledby="vc-board-title" className="mt-8">
      <div>
        <h2 id="vc-board-title" className="text-base font-semibold">
          Workshop board
        </h2>
        <p className="text-sm text-muted-foreground">Every problem and work order on {ctx.ws.vehicle.code}, moving left to right. Each card says who has the next move.</p>
      </div>

      <div className={cn("mt-3 hidden gap-3 @4xl:grid", doneOpen ? "grid-cols-5" : "grid-cols-[repeat(4,minmax(0,1fr))_10.5rem]")}>
        {lanes.map((lane) => (
          <LaneColumn
            key={lane.id}
            ctx={ctx}
            lane={lane}
            collapsed={lane.id === "done" && !doneOpen}
            onToggle={lane.id === "done" ? () => setDoneOpen((o) => !o) : null}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-2 @4xl:hidden">
        {lanes.map((lane) => (
          <LaneSection key={lane.id} ctx={ctx} lane={lane} open={open[lane.id]} onToggle={() => setOpen((p) => ({ ...p, [lane.id]: !p[lane.id] }))} />
        ))}
      </div>
    </section>
  );
}

function LaneCount({ n }: { n: number }) {
  return <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-background px-1.5 text-xs font-medium tabular-nums ring-1 ring-foreground/10">{n}</span>;
}

function LaneColumn({ ctx, lane, collapsed, onToggle }: { ctx: Ctx; lane: Lane; collapsed: boolean; onToggle: (() => void) | null }) {
  const add = lane.add && lane.items.length > 0 && ctx.actions.can(lane.add.key) ? lane.add : null;
  return (
    <div className="flex min-h-72 min-w-0 flex-col rounded-xl bg-muted/60 p-2 dark:bg-muted/30">
      <div className="px-1.5 pt-1 pb-2">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold" title={lane.title}>
            {lane.title}
          </h3>
          <LaneCount n={lane.items.length} />
          {add && (
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon-xs" className="ml-auto" aria-label={add.label} onClick={() => ctx.actions.open(add.key, null)} />}
              >
                <Plus aria-hidden />
              </TooltipTrigger>
              <TooltipContent>{add.label}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{lane.hint}</p>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {lane.items.length === 0 ? (
          <EmptyLane ctx={ctx} lane={lane} />
        ) : collapsed ? (
          lane.items.map((item) => <CompactCard key={item.type === "wo" ? item.wo.ref : item.issue.ref} ctx={ctx} item={item} />)
        ) : (
          lane.items.map((item) => <BoardCard key={item.type === "wo" ? item.wo.ref : item.issue.ref} ctx={ctx} item={item} />)
        )}
      </div>
      {onToggle && lane.items.length > 0 && (
        <Button variant="ghost" size="xs" className="mt-2 self-start text-muted-foreground" onClick={onToggle}>
          {collapsed ? "Show full cards" : "Collapse"}
        </Button>
      )}
    </div>
  );
}

function EmptyLane({ ctx, lane }: { ctx: Ctx; lane: Lane }) {
  const add = lane.add && ctx.actions.can(lane.add.key) ? lane.add : null;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-foreground/15 px-3 py-6 text-center text-xs text-muted-foreground">
      <span>{lane.empty}</span>
      {add && <ActionButton ctx={ctx} actionKey={add.key} refId={null} label={add.label} size="xs" />}
    </div>
  );
}

function LaneSection({ ctx, lane, open, onToggle }: { ctx: Ctx; lane: Lane; open: boolean; onToggle: () => void }) {
  const add = lane.add && ctx.actions.can(lane.add.key) ? lane.add : null;
  const safety = lane.items.some(itemSafety);
  const preview = lane.items.map((i) => (i.type === "wo" ? i.wo.title : i.issue.title)).join(" · ");
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center pr-2">
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-3 text-left">
          <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden />
          <span className="shrink-0 text-sm font-semibold">{lane.title}</span>
          <LaneCount n={lane.items.length} />
          {safety && <ShieldAlert className="size-4 shrink-0 text-red-600 dark:text-red-400" aria-label="Safety-critical inside" />}
          {!open && preview && <span className="min-w-0 truncate text-xs text-muted-foreground">{preview}</span>}
        </button>
        {add && (
          <Button variant="ghost" size="icon-sm" aria-label={add.label} onClick={() => ctx.actions.open(add.key, null)}>
            <Plus aria-hidden />
          </Button>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-2 border-t bg-muted/40 p-2">
          <p className="px-1 text-xs text-muted-foreground">{lane.hint}</p>
          {lane.items.length === 0 ? (
            <EmptyLane ctx={ctx} lane={lane} />
          ) : (
            lane.items.map((item) => <BoardCard key={item.type === "wo" ? item.wo.ref : item.issue.ref} ctx={ctx} item={item} />)
          )}
        </div>
      )}
    </div>
  );
}

function CardLine({ icon: Icon, children, className }: { icon: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <li className={cn("flex items-start gap-1.5", className)}>
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function ChecklistBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Checklist</span>
        <span className="font-medium tabular-nums">
          {done}/{total}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Checklist progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <div className="h-full rounded-full bg-sky-600 transition-[width] dark:bg-sky-400" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CostBox({ wo }: { wo: WorkOrder }) {
  const recorded = sum(wo.costLines.map((c) => c.amountMinor));
  const pending = sum(wo.costLines.filter((c) => c.entryStatus === "SUBMITTED").map((c) => c.amountMinor));
  if (wo.status === "PENDING_CLOSE" || wo.status === "CLOSED") {
    const expected = wo.expectedCostMinor;
    const actual = wo.actualCostMinor;
    const over = expected !== null && actual !== null ? actual - expected : null;
    return (
      <div className="space-y-0.5 rounded-md bg-muted/70 px-2 py-1.5 text-xs tabular-nums">
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Expected</span>
          <span>{expected !== null ? formatXaf(expected) : "Not set"}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Actual</span>
          <span className="font-medium">{actual !== null ? formatXaf(actual) : "Not recorded"}</span>
        </div>
        {over !== null && over > 0 && expected !== null && (
          <p className="flex items-center gap-1 pt-0.5 font-medium text-amber-800 dark:text-amber-300">
            <TrendingUp className="size-3.5" aria-hidden />
            {formatXaf(over)} over ({Math.round((over / expected) * 100)}%)
          </p>
        )}
      </div>
    );
  }
  if (wo.status === "CANCELLED") return null;
  return (
    <div className="space-y-0.5 rounded-md bg-muted/70 px-2 py-1.5 text-xs tabular-nums">
      <div className="flex justify-between gap-2">
        <span className="text-muted-foreground">Expected</span>
        <span>{wo.expectedCostMinor !== null ? formatXaf(wo.expectedCostMinor) : "Not set"}</span>
      </div>
      <div className="flex justify-between gap-2">
        <span className="text-muted-foreground">Recorded</span>
        <span className="font-medium">{recorded > 0 ? formatXaf(recorded) : "Nothing yet"}</span>
      </div>
      {pending > 0 && <p className="pt-0.5 text-amber-800 dark:text-amber-300">{formatXaf(pending)} awaiting review</p>}
    </div>
  );
}

function BoardCard({ ctx, item }: { ctx: Ctx; item: BoardItem }) {
  const target: DetailRef = item.type === "issue" ? { kind: "issue", ref: item.issue.ref } : { kind: "workOrder", ref: item.wo.ref };
  const safety = itemSafety(item);
  const title = item.type === "issue" ? item.issue.title : item.wo.title;
  const next = cardNext(ctx.ws, item);
  const canAct = next ? ctx.actions.can(next.action) : false;
  return (
    <article
      className={cn(
        "group/card relative rounded-lg bg-card p-3 shadow-xs ring-1 ring-foreground/10 transition-shadow hover:shadow-md hover:ring-foreground/20",
        safety && "border-l-[3px] border-l-red-500 pl-2.5",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground tabular-nums">{target.ref}</span>
        {safety && (
          <Tag tone="critical" icon={ShieldAlert}>
            Safety-critical
          </Tag>
        )}
        {!safety && item.type === "wo" && (item.wo.status === "CLOSED" || item.wo.status === "CANCELLED") && (
          <Tag tone={WO_TONE[item.wo.status]}>{WORK_ORDER_STATUS_LABELS[item.wo.status]}</Tag>
        )}
      </div>
      <h4 className="mt-1 text-sm leading-snug font-medium">
        <button
          type="button"
          onClick={() => ctx.show(target)}
          className="text-left decoration-foreground/30 underline-offset-2 outline-none group-hover/card:underline after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
        >
          {title}
        </button>
      </h4>

      {item.type === "issue" ? (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          <CardLine icon={UserRound}>
            {item.issue.reportedBy} · {relativeDays(item.issue.reportedAt)}
          </CardLine>
          <CardLine icon={Camera}>
            {item.issue.category}
            {item.issue.photos > 0 ? ` · ${plural(item.issue.photos, "photo")}` : " · no photo"}
          </CardLine>
          {!item.issue.safetyCritical && <CardLine icon={CircleCheck}>Not grounding: it can still run</CardLine>}
        </ul>
      ) : (
        <WorkOrderCardBody ctx={ctx} wo={item.wo} />
      )}

      {next && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-2 border-t pt-2.5">
          <span className="text-xs text-muted-foreground">
            Next: <span className="font-medium text-foreground">{next.who}</span>
          </span>
          {canAct && (
            <ActionButton
              ctx={ctx}
              actionKey={next.action}
              refId={target.ref}
              label={next.label}
              size="xs"
              variant={item.type === "wo" && item.wo.status === "OPEN" ? "default" : "outline"}
              className="relative z-10"
            />
          )}
        </div>
      )}
    </article>
  );
}

function WorkOrderCardBody({ ctx, wo }: { ctx: Ctx; wo: WorkOrder }) {
  const { done, total } = progress(wo, ctx.checklists);
  const due = wo.dueBy ? dueText(wo.dueBy) : null;
  return (
    <div className="mt-2 space-y-2">
      {wo.status === "OPEN" && total > 0 && <ChecklistBar done={done} total={total} />}
      <ul className="space-y-1 text-xs text-muted-foreground">
        <CardLine icon={UserRound}>{wo.assignee}</CardLine>
        {wo.issueRef && (
          <CardLine icon={TriangleAlert}>
            From <RefLink ctx={ctx} to={{ kind: "issue", ref: wo.issueRef }} className="text-foreground" />
          </CardLine>
        )}
        {due && wo.dueBy && (wo.status === "OPEN" || wo.status === "SUBMITTED") && (
          <CardLine icon={CalendarClock} className={cn(due.tone === "warning" && "text-amber-800 dark:text-amber-300", due.tone === "critical" && "text-red-700 dark:text-red-300")}>
            {due.text} · {shortDate(wo.dueBy)}
          </CardLine>
        )}
        {wo.status === "PENDING_CLOSE" && wo.completedAt && (
          <CardLine icon={CircleCheck}>
            Completed {shortDate(wo.completedAt)}
            {wo.completedBy ? ` by ${personName(wo.completedBy)}` : ""}
          </CardLine>
        )}
        {(wo.status === "CLOSED" || wo.status === "CANCELLED") && wo.summary && (
          <CardLine icon={FileText}>
            <span className="line-clamp-2">{wo.summary}</span>
          </CardLine>
        )}
      </ul>
      <CostBox wo={wo} />
    </div>
  );
}

function CompactCard({ ctx, item }: { ctx: Ctx; item: BoardItem }) {
  if (item.type !== "wo") return null;
  const wo = item.wo;
  return (
    <button
      type="button"
      onClick={() => ctx.show({ kind: "workOrder", ref: wo.ref })}
      className="rounded-lg bg-card px-2.5 py-2 text-left text-xs shadow-xs ring-1 ring-foreground/10 transition-shadow outline-none hover:ring-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-medium tabular-nums">{wo.ref}</span>
        <Tag tone={WO_TONE[wo.status]}>{wo.status === "CLOSED" ? "Closed" : "Cancelled"}</Tag>
      </span>
      <span className="mt-1 line-clamp-2 block text-muted-foreground">{wo.title}</span>
      <span className="mt-1 block text-muted-foreground tabular-nums">
        {shortDate(wo.completedAt ?? wo.createdAt)}
        {wo.actualCostMinor !== null ? ` · ${formatXaf(wo.actualCostMinor)}` : ""}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------ side strip */

function SideBlock({
  title,
  icon: Icon,
  badge,
  action,
  footer,
  children,
}: {
  title: string;
  icon: LucideIcon;
  badge?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border bg-card">
      <header className="flex min-h-12 items-center gap-2 border-b px-4 py-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        {badge}
        <div className="ml-auto shrink-0">{action}</div>
      </header>
      <div className="flex-1 px-4">{children}</div>
      {footer ? <footer className="border-t px-4 py-2.5 text-xs text-muted-foreground">{footer}</footer> : null}
    </section>
  );
}

interface ServicePlan {
  id: string;
  label: string;
  everyKm: number;
  lastKm: number;
  lastAt: string;
  lastRef: string | null;
}

// Proposed capability: no reminder data exists yet, so the plan lives here.
const SERVICE_PLAN: readonly ServicePlan[] = [
  { id: "grease", label: "Chassis greasing", everyKm: 5_000, lastKm: 180_100, lastAt: "2026-07-29", lastRef: null },
  { id: "oil", label: "Oil and filters", everyKm: 20_000, lastKm: 178_400, lastAt: "2026-06-02", lastRef: null },
  { id: "tyres", label: "Tyre rotation", everyKm: 30_000, lastKm: 183_600, lastAt: "2026-09-19", lastRef: "OT-0013" },
];

function paceText(leftKm: number, perDay: number): string {
  if (perDay <= 0) return "pace unknown";
  const days = Math.round(leftKm / perDay);
  if (days < 60) return `about ${plural(days, "day")}`;
  return `about ${Math.round(days / 30)} months`;
}

function ServiceDue({ ctx }: { ctx: Ctx }) {
  const { ws, actions } = ctx;
  const odo = ws.meter.odometerKm;
  const perDay = ws.meter.km30d / 30;
  const rows = SERVICE_PLAN.map((s) => {
    const dueAt = s.lastKm + s.everyKm;
    return { ...s, dueAt, left: dueAt - odo, used: odo - s.lastKm };
  }).sort((a, b) => a.left - b.left);
  return (
    <SideBlock
      title="Service due"
      icon={CalendarClock}
      badge={<Tag tone="info">Proposed</Tag>}
      action={actions.can("schedule-service") ? <ActionButton ctx={ctx} actionKey="schedule-service" label="Schedule" size="xs" variant="ghost" /> : null}
      footer={`Reminders suggest a work order, never create one. Pace: ${km(ws.meter.km30d)} in the last 30 days.`}
    >
      <ul className="divide-y">
        {rows.map((r) => {
          const soon = r.left <= 1_000;
          return (
            <li key={r.id} className="py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{r.label}</span>
                <span className={cn("text-sm font-medium tabular-nums", soon && "text-amber-800 dark:text-amber-300", r.left <= 0 && "text-red-700 dark:text-red-300")}>
                  {r.left <= 0 ? `${km(-r.left)} overdue` : `${km(r.left)} left`}
                </span>
              </div>
              <div className="mt-1.5">
                <Bar value={r.used} max={r.everyKm} className={cn(soon ? "bg-amber-500" : "bg-foreground/40", r.left <= 0 && "bg-red-500")} />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
                Every {km(r.everyKm)} · last {km(r.lastKm)}, {shortDate(r.lastAt)}
                {r.lastRef && (
                  <>
                    , <RefLink ctx={ctx} to={{ kind: "workOrder", ref: r.lastRef }} className="text-foreground" />
                  </>
                )}
                {r.left > 0 && ` · ${paceText(r.left, perDay)}`}
              </p>
              {soon && actions.can("create-work-order") && (
                <ActionButton ctx={ctx} actionKey="create-work-order" refId={null} label="Plan the work order" size="xs" className="mt-2" />
              )}
            </li>
          );
        })}
      </ul>
    </SideBlock>
  );
}

function WorkshopSpend({ ctx }: { ctx: Ctx }) {
  const { ws, actions } = ctx;
  const month = ws.money.period;
  const maint = ws.entries
    .filter((e) => e.layer === "MAINTENANCE" && e.direction === "EXPENSE" && e.economicDate.startsWith(month))
    .sort((a, b) => b.economicDate.localeCompare(a.economicDate));
  const posted = sum(maint.filter((e) => e.status === "POSTED").map((e) => e.amountMinor));
  const pending = maint.filter((e) => e.status === "SUBMITTED");
  const unrecorded = ws.workOrders
    .filter((w) => w.status !== "CANCELLED" && (w.completedAt ?? w.createdAt).startsWith(month))
    .flatMap((w) => w.costLines.filter((c) => c.entryNumber === null).map((c) => ({ wo: w.ref, line: c })));
  return (
    <SideBlock title={`Workshop spend · ${ws.money.periodLabel.split(" ")[0] ?? ""}`} icon={Coins} footer="Maintenance entries for this vehicle. Posted is not paid.">
      <dl className="grid grid-cols-2 gap-3 py-3">
        <div>
          <dt className="text-xs text-muted-foreground">Posted</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatXaf(posted)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Awaiting review</dt>
          <dd className="text-lg font-semibold text-amber-800 tabular-nums dark:text-amber-300">{formatXaf(sum(pending.map((e) => e.amountMinor)))}</dd>
          <dd className="text-xs text-muted-foreground">Not added to posted</dd>
        </div>
      </dl>
      <p className="text-xs font-medium text-muted-foreground">By work order</p>
      {maint.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">No maintenance entries this month.</p>
      ) : (
        <ul className="divide-y">
          {maint.map((e) => {
            const woRef = e.link?.kind === "WORK_ORDER" ? e.link.ref : null;
            const wo = woRef ? ws.workOrders.find((w) => w.ref === woRef) : undefined;
            return (
              <li key={e.id} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-baseline gap-1.5 text-sm">
                    {woRef ? <RefLink ctx={ctx} to={{ kind: "workOrder", ref: woRef }} /> : <span className="font-medium">Not linked</span>}
                    <span className="truncate text-muted-foreground">{wo?.title ?? ""}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <RefLink ctx={ctx} to={{ kind: "entry", ref: e.number }} className="font-normal" />
                    {e.counterparty ? ` · ${e.counterparty}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-medium tabular-nums">{formatXaf(e.amountMinor)}</span>
                  <Tag tone={ENTRY_TONE[e.status]}>{ENTRY_STATUS_LABELS[e.status]}</Tag>
                  {e.status === "SUBMITTED" && actions.can("review-entry") && (
                    <ActionButton ctx={ctx} actionKey="review-entry" refId={e.number} label="Review" size="xs" className="relative z-10" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {unrecorded.length > 0 && (
        <p className="mb-3 rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
          Not recorded as expenses, so not counted:{" "}
          {unrecorded.map((u, i) => (
            <Fragment key={`${u.wo}-${u.line.label}`}>
              {i > 0 && "; "}
              {u.line.label.toLowerCase()} on <RefLink ctx={ctx} to={{ kind: "workOrder", ref: u.wo }} className="text-foreground" />, {formatXaf(u.line.amountMinor)}
            </Fragment>
          ))}
          .
        </p>
      )}
    </SideBlock>
  );
}

function Readings({ ctx }: { ctx: Ctx }) {
  const { ws, actions } = ctx;
  const rs = ws.readings;
  const deltas = rs.map((r, i) => {
    const prev = rs[i + 1];
    return prev ? r.valueKm - prev.valueKm : null;
  });
  const max = Math.max(1, ...deltas.filter((d): d is number => d !== null));
  return (
    <SideBlock
      title="Odometer"
      icon={Gauge}
      action={actions.can("record-reading") ? <ActionButton ctx={ctx} actionKey="record-reading" label="Record" size="xs" variant="ghost" /> : null}
      footer="Readings are reported by people. A lower value is kept with a warning, never refused."
    >
      <div className="py-3">
        <p className="text-2xl font-semibold tabular-nums">{km(ws.meter.odometerKm)}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          +{km(ws.meter.km30d)} in the last 30 days · about {Math.round(ws.meter.km30d / 30)} km a day
        </p>
      </div>
      <div className="flex justify-between text-xs font-medium text-muted-foreground">
        <span>Recent readings</span>
        <span>Since previous</span>
      </div>
      <ul className="divide-y">
        {rs.map((r, i) => {
          const delta = deltas[i] ?? null;
          return (
            <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium tabular-nums">{km(r.valueKm)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {shortDate(r.observedAt)} · {r.source} · {r.by}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-12">{delta !== null && <Bar value={delta} max={max} />}</span>
                <span className="w-14 text-right text-xs text-muted-foreground tabular-nums">{delta !== null ? `+${delta.toLocaleString("en-US")}` : "First"}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </SideBlock>
  );
}

/* --------------------------------------------------------------- records */

type PanelId = "money" | "documents" | "trips" | "history";

function Records({ ctx }: { ctx: Ctx }) {
  const [panel, setPanel] = useState<PanelId>("money");
  return (
    <Tabs value={panel} onValueChange={(value) => setPanel(value as PanelId)} className="mt-10 gap-3">
      <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-end @2xl:justify-between">
        <div>
          <h2 className="text-base font-semibold">Records</h2>
          <p className="text-sm text-muted-foreground">Behind the board: money, documents, trips and the full history.</p>
        </div>
        <TabsList className="w-full @2xl:w-auto">
          <TabsTrigger value="money">Money</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="trips">Trips</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
      </div>
      <div className="rounded-xl border bg-card p-3 @2xl:p-4">
        <TabsContent value="money">
          <MoneyPanel ctx={ctx} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsPanel ctx={ctx} />
        </TabsContent>
        <TabsContent value="trips">
          <TripsPanel ctx={ctx} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryPanel ctx={ctx} />
        </TabsContent>
      </div>
    </Tabs>
  );
}

function PanelBar({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 @2xl:flex-row @2xl:items-center @2xl:justify-between">
      <p className="text-sm text-muted-foreground">{children}</p>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

function Figure({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "warning" }) {
  return (
    <div className="min-w-0 bg-card px-3 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 text-lg font-semibold tabular-nums", tone === "warning" && "text-amber-800 dark:text-amber-300")}>{value}</dd>
      <dd className="mt-0.5 text-xs text-muted-foreground">{note}</dd>
    </div>
  );
}

function MoneyPanel({ ctx }: { ctx: Ctx }) {
  const { ws, actions } = ctx;
  const m = ws.money;
  const entries = [...ws.entries].sort((a, b) => b.economicDate.localeCompare(a.economicDate));
  const maxCat = Math.max(1, ...m.byCategory.map((c) => c.minor));
  const maxMonth = Math.max(1, ...m.monthly.flatMap((x) => [x.expenseMinor, x.revenueMinor]));
  return (
    <div className="space-y-5">
      <PanelBar
        actions={
          <>
            {actions.can("record-expense") && <ActionButton ctx={ctx} actionKey="record-expense" size="sm" />}
            {actions.can("record-revenue") && <ActionButton ctx={ctx} actionKey="record-revenue" size="sm" />}
          </>
        }
      >
        {m.periodLabel}. Amounts are this vehicle's share of each entry.
      </PanelBar>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border @3xl:grid-cols-4">
        <Figure label="Posted expenses" value={formatXaf(m.postedExpenseMinor)} note="Posting period. Direct, maintenance and ownership layers." />
        <Figure label="Awaiting review" value={formatXaf(m.pendingReviewMinor)} note={`${plural(m.pendingReviewCount, "entry", "entries")} by economic date. Not in posted.`} tone="warning" />
        <Figure label="Missing receipts" value={plural(m.missingEvidenceCount, "entry", "entries")} note="Recorded without evidence" tone="warning" />
        <Figure label="Cost per km" value={m.costPerKm ? formatXaf(m.costPerKm.minor) : "Not enough data"} note={m.costPerKm?.basis ?? "Needs start and end readings"} />
      </dl>

      <div className="grid gap-6 @4xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Entries</h3>
          <ul className="mt-2 divide-y overflow-hidden rounded-lg border">
            {entries.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => ctx.show({ kind: "entry", ref: e.number })}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-2.5 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/60"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-medium tabular-nums">{e.number}</span>
                      <span>{e.category}</span>
                      {e.counterparty && <span className="truncate text-muted-foreground">{e.counterparty}</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {shortDate(e.economicDate)} · {LAYER_LABELS[e.layer]} · by {e.recordedBy}
                      {e.link ? (
                        <>
                          {" · "}
                          <span className="whitespace-nowrap">
                            {e.link.kind === "WORK_ORDER" ? "for" : e.link.kind === "TRIP" ? "trip" : "document"} {e.link.ref}
                          </span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={cn("text-sm font-medium tabular-nums", e.direction === "REVENUE" && "text-emerald-700 dark:text-emerald-300")}>
                      {formatXaf(e.amountMinor, { signed: e.direction === "REVENUE" })}
                    </span>
                    {e.amountMinor !== e.entryTotalMinor && <span className="text-xs text-muted-foreground tabular-nums">of {formatXaf(e.entryTotalMinor)}</span>}
                    <span className="flex flex-wrap justify-end gap-1">
                      {e.evidence === "MISSING" && (
                        <Tag tone="warning" icon={Receipt}>
                          No receipt
                        </Tag>
                      )}
                      <Tag tone={ENTRY_TONE[e.status]}>{ENTRY_STATUS_LABELS[e.status]}</Tag>
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Nothing is edited away: a correction is a reversal, and both stay in History.</p>
        </div>

        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold">Posted by category</h3>
            <ul className="mt-2 space-y-2.5">
              {m.byCategory.map((c) => (
                <li key={c.label}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span>
                      {c.label} <span className="text-muted-foreground">· {LAYER_LABELS[c.layer]}</span>
                    </span>
                    <span className="tabular-nums">{formatXaf(c.minor)}</span>
                  </div>
                  <div className="mt-1">
                    <Bar value={c.minor} max={maxCat} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Last six months, posted</h3>
            <div className="mt-3 flex h-28 items-end gap-2">
              {m.monthly.map((x) => (
                <div key={x.month} className="flex h-full flex-1 flex-col items-center gap-1">
                  <div className="flex w-full flex-1 items-end justify-center gap-0.5">
                    <span
                      className="w-2.5 rounded-t-sm bg-foreground/55"
                      style={{ height: `${Math.round((x.expenseMinor / maxMonth) * 100)}%` }}
                      title={`${x.label} expenses ${formatXaf(x.expenseMinor)}`}
                    />
                    <span
                      className="w-2.5 rounded-t-sm bg-emerald-500/70"
                      style={{ height: `${Math.round((x.revenueMinor / maxMonth) * 100)}%` }}
                      title={`${x.label} revenue ${formatXaf(x.revenueMinor)}`}
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground">{x.label}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-foreground/55" aria-hidden />
                Expenses
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-emerald-500/70" aria-hidden />
                Revenue
              </span>
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Since acquisition</h3>
            <dl className="mt-2 space-y-1 text-xs tabular-nums">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Revenue</dt>
                <dd>{formatXaf(m.lifetime.revenueMinor)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Expenses</dt>
                <dd>{formatXaf(m.lifetime.expenseMinor)}</dd>
              </div>
              <div className="flex justify-between border-t pt-1 font-medium">
                <dt>Net</dt>
                <dd>{formatXaf(m.lifetime.netMinor, { signed: true })}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

function DocumentsPanel({ ctx }: { ctx: Ctx }) {
  const { ws, actions } = ctx;
  const order: Record<VehicleDocument["state"], number> = { EXPIRED: 0, EXPIRING: 1, VALID: 2, NO_EXPIRY: 3 };
  const docs = [...ws.documents].sort((a, b) => order[a.state] - order[b.state]);
  return (
    <div className="space-y-4">
      <PanelBar actions={actions.can("add-document") ? <ActionButton ctx={ctx} actionKey="add-document" size="sm" /> : null}>
        Renewing keeps the old version. A missing expiry date shows as unknown, never as valid.
      </PanelBar>
      <ul className="divide-y overflow-hidden rounded-lg border">
        {docs.map((d) => {
          const st = docStatus(d);
          return (
            <li key={d.id} className="flex flex-col gap-2 px-3 py-3 @2xl:flex-row @2xl:items-center">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <RefLink ctx={ctx} to={{ kind: "document", ref: d.id }}>
                    {d.type}
                  </RefLink>
                  <Tag tone={st.tone}>{st.label}</Tag>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {d.number ?? "No number"}
                  {d.issuedAt ? ` · issued ${formatDate(d.issuedAt)}` : ""}
                  {d.expiresAt ? ` · ${d.state === "EXPIRED" ? "expired" : "expires"} ${formatDate(d.expiresAt)}` : " · no expiry date"}
                  {d.hasFile ? " · scan attached" : " · no scan on file"}
                  {d.previousVersions > 0 ? ` · ${plural(d.previousVersions, "earlier version")} kept` : ""}
                </p>
              </div>
              {d.expiresAt && actions.can("renew-document") && (
                <ActionButton ctx={ctx} actionKey="renew-document" refId={d.id} label="Renew" size="sm" variant={d.state === "EXPIRED" ? "default" : "outline"} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TripsPanel({ ctx }: { ctx: Ctx }) {
  const { ws, actions } = ctx;
  return (
    <div className="space-y-4">
      <PanelBar actions={actions.can("start-trip") ? <ActionButton ctx={ctx} actionKey="start-trip" size="sm" /> : null}>
        Fuel, tolls and readings recorded on a trip open from the trip.
      </PanelBar>
      {ws.trips.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">No trips recorded for this vehicle.</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {ws.trips.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => ctx.show({ kind: "trip", ref: t.number })}
                className="grid w-full gap-1 px-3 py-3 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/60 @2xl:grid-cols-[minmax(0,1fr)_auto] @2xl:gap-x-4"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-medium tabular-nums">{t.number}</span>
                    <span>
                      {t.from} → {t.to}
                    </span>
                    <Tag tone={t.status === "OPEN" ? "info" : "neutral"}>{t.status === "OPEN" ? "Open" : "Closed"}</Tag>
                    {t.exceptions > 0 && (
                      <Tag tone="warning" icon={TriangleAlert}>
                        {plural(t.exceptions, "exception")}
                      </Tag>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t.type} · {t.customer ?? "No customer"} · driver {t.driver} · {shortDate(t.startedAt)}
                    {t.endedAt ? ` to ${shortDate(t.endedAt)}` : ", still open"}
                    {t.distanceKm !== null ? ` · ${km(t.distanceKm)}` : ""}
                  </p>
                </div>
                <div className="text-xs tabular-nums @2xl:text-right">
                  <p className="text-sm">{t.revenueMinor !== null ? formatXaf(t.revenueMinor, { signed: true }) : "No revenue recorded"}</p>
                  <p className="text-muted-foreground">{t.costMinor > 0 ? `Costs ${formatXaf(t.costMinor)}` : "No costs recorded"}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HistoryPanel({ ctx }: { ctx: Ctx }) {
  const { ws } = ctx;
  const [kind, setKind] = useState<TimelineKind | "ALL">("ALL");
  const counts = new Map<TimelineKind, number>();
  for (const ev of ws.timeline) counts.set(ev.kind, (counts.get(ev.kind) ?? 0) + 1);
  const kinds = (Object.keys(KIND_META) as TimelineKind[]).filter((k) => counts.has(k));
  const events = kind === "ALL" ? ws.timeline : ws.timeline.filter((e) => e.kind === kind);
  const groups: Array<{ label: string; events: TimelineEvent[] }> = [];
  for (const ev of events) {
    const label = new Date(ev.at).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const last = groups.at(-1);
    if (last && last.label === label) last.events.push(ev);
    else groups.push({ label, events: [ev] });
  }
  return (
    <div className="space-y-5">
      <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 *:shrink-0 @2xl:mx-0 @2xl:flex-wrap @2xl:overflow-visible @2xl:px-0" role="group" aria-label="Filter history by kind">
        <Button size="xs" variant={kind === "ALL" ? "default" : "outline"} aria-pressed={kind === "ALL"} onClick={() => setKind("ALL")}>
          All <span className="tabular-nums opacity-70">{ws.timeline.length}</span>
        </Button>
        {kinds.map((k) => {
          const Icon = KIND_META[k].icon;
          return (
            <Button key={k} size="xs" variant={kind === k ? "default" : "outline"} aria-pressed={kind === k} onClick={() => setKind(k)}>
              <Icon aria-hidden />
              {KIND_META[k].label} <span className="tabular-nums opacity-70">{counts.get(k)}</span>
            </Button>
          );
        })}
      </div>
      {groups.map((g) => (
        <div key={g.label}>
          <h3 className="text-xs font-semibold text-muted-foreground">{g.label}</h3>
          <ol className="mt-2 max-w-3xl">
            {g.events.map((ev, i) => (
              <HistoryRow key={ev.id} ctx={ctx} ev={ev} last={i === g.events.length - 1} />
            ))}
          </ol>
        </div>
      ))}
      <p className="border-t pt-3 text-xs text-muted-foreground">
        {plural(events.length, "event")} shown{kind === "ALL" ? ", the complete history" : ` of ${ws.timeline.length}`}. Corrections appear as reversals; nothing is deleted.
      </p>
    </div>
  );
}

function HistoryRow({ ctx, ev, last }: { ctx: Ctx; ev: TimelineEvent; last: boolean }) {
  const Icon = KIND_META[ev.kind].icon;
  const target = eventTarget(ev);
  return (
    <li className="relative flex gap-3 pb-4">
      {!last && <span aria-hidden className="absolute top-9 bottom-1 left-4 w-px -translate-x-1/2 bg-border" />}
      <span className={cn("relative flex size-8 shrink-0 items-center justify-center rounded-full", EVENT_TONE[ev.tone])}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="text-sm font-medium">{ev.title}</p>
          {ev.amountMinor !== null && <span className="text-sm tabular-nums">{formatXaf(ev.amountMinor)}</span>}
        </div>
        {ev.detail && <p className="text-xs text-muted-foreground">{ev.detail}</p>}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatDateTime(ev.at)} · {ev.actor}
          {target && resolvable(ctx.ws, target) && (
            <>
              {" · "}
              <RefLink ctx={ctx} to={target} className="text-foreground" />
            </>
          )}
        </p>
      </div>
    </li>
  );
}

/* --------------------------------------------------------- detail sheet */

function DetailSheet({ ctx, trail, setTrail }: { ctx: Ctx; trail: DetailRef[]; setTrail: (t: DetailRef[]) => void }) {
  const isMobile = useIsMobile();
  const current = trail.at(-1) ?? null;
  const previous = trail.length > 1 ? trail.at(-2) : undefined;
  const close = () => setTrail([]);
  const inner: Ctx = { ...ctx, show: (d) => setTrail([...trail, d]) };
  const run = (key: ActionKey, refId: string | null) => {
    close();
    ctx.actions.open(key, refId);
  };
  const back = previous ? (
    <Button variant="ghost" size="xs" className="-ml-1.5 mb-1 self-start text-muted-foreground" onClick={() => setTrail(trail.slice(0, -1))}>
      <ArrowLeft aria-hidden />
      Back to {refLabel(ctx.ws, previous)}
    </Button>
  ) : null;

  return (
    <Sheet open={current !== null} onOpenChange={(o) => !o && close()}>
      <SheetContent side={isMobile ? "bottom" : "right"} className={cn("gap-0 overflow-y-auto", isMobile ? "max-h-[92vh]" : "w-full sm:max-w-lg")}>
        {current?.kind === "workOrder" && <WorkOrderDetail ctx={inner} id={current.ref} run={run} back={back} />}
        {current?.kind === "issue" && <IssueDetail ctx={inner} id={current.ref} run={run} back={back} />}
        {current?.kind === "entry" && <EntryDetail ctx={inner} id={current.ref} run={run} back={back} />}
        {current?.kind === "trip" && <TripDetail ctx={inner} id={current.ref} run={run} back={back} />}
        {current?.kind === "document" && <DocumentDetail ctx={inner} id={current.ref} run={run} back={back} />}
      </SheetContent>
    </Sheet>
  );
}

type Run = (key: ActionKey, refId: string | null) => void;
interface DetailProps {
  ctx: Ctx;
  id: string;
  run: Run;
  back: ReactNode;
}
interface FooterAction {
  key: ActionKey;
  refId: string | null;
  label?: string;
}

function DetailLayout({
  back,
  eyebrow,
  title,
  tags,
  children,
  ctx,
  run,
  footer,
}: {
  back: ReactNode;
  eyebrow: string;
  title: string;
  tags: ReactNode;
  children: ReactNode;
  ctx: Ctx;
  run: Run;
  footer: FooterAction[];
}) {
  const allowed = footer.filter((a) => ctx.actions.can(a.key));
  return (
    <>
      <SheetHeader className="border-b pr-12">
        {back}
        <p className="text-xs font-medium text-muted-foreground">{eyebrow}</p>
        <SheetTitle className="text-lg leading-snug font-semibold">{title}</SheetTitle>
        <div className="mt-1.5 flex flex-wrap gap-1.5">{tags}</div>
      </SheetHeader>
      <div className="grid gap-6 p-4">{children}</div>
      {allowed.length > 0 && (
        <SheetFooter className="sticky bottom-0 flex-row flex-wrap border-t bg-popover">
          {allowed.map((a, i) => {
            const action = actionByKey(a.key);
            const Icon = action.icon;
            return (
              <Button key={a.key} variant={i === 0 ? "default" : "outline"} onClick={() => run(a.key, a.refId)}>
                <Icon data-icon="inline-start" aria-hidden />
                {a.label ?? action.label}
              </Button>
            );
          })}
        </SheetFooter>
      )}
    </>
  );
}

function DetailSection({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Chronology({ ctx, targets }: { ctx: Ctx; targets: DetailRef[] }) {
  const events = ctx.ws.timeline
    .filter((ev) => {
      const t = eventTarget(ev);
      return t !== null && targets.some((x) => x.kind === t.kind && x.ref === t.ref);
    })
    .sort((a, b) => a.at.localeCompare(b.at));
  return (
    <DetailSection title="Chronology">
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recorded events yet.</p>
      ) : (
        <ol className="space-y-3 border-l pl-4">
          {events.map((ev) => (
            <li key={ev.id} className="relative">
              <span
                aria-hidden
                className={cn(
                  "absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-2 ring-popover",
                  ev.tone === "critical" ? "bg-red-500" : ev.tone === "warning" ? "bg-amber-500" : ev.tone === "success" ? "bg-emerald-500" : "bg-foreground/40",
                )}
              />
              <p className="text-sm">{ev.title}</p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(ev.at)} · {ev.actor}
                {ev.amountMinor !== null ? ` · ${formatXaf(ev.amountMinor)}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </DetailSection>
  );
}

function NotFound({ back, what }: { back: ReactNode; what: string }) {
  return (
    <SheetHeader>
      {back}
      <SheetTitle>{what} is not in this sample</SheetTitle>
    </SheetHeader>
  );
}

function WorkOrderDetail({ ctx, id, run, back }: DetailProps) {
  const { ws, actions } = ctx;
  const wo = ws.workOrders.find((w) => w.ref === id);
  if (!wo) return <NotFound back={back} what={id} />;
  const list = ctx.checklists[wo.ref] ?? wo.checklist.map((c) => c.done);
  const canTick = wo.status === "OPEN" && actions.can("complete-work-order");
  const { done, total } = progress(wo, ctx.checklists);
  const recorded = sum(wo.costLines.map((c) => c.amountMinor));
  const due = wo.dueBy ? dueText(wo.dueBy) : null;
  const releasable = ws.readiness.state === "GROUNDED" && ws.readiness.workOrderRef === wo.ref;
  const byStatus: FooterAction[] =
    wo.status === "SUBMITTED"
      ? [
          { key: "approve-work-order", refId: wo.ref },
          { key: "cancel-work-order", refId: wo.ref },
        ]
      : wo.status === "OPEN"
        ? [
            { key: "complete-work-order", refId: wo.ref },
            { key: "record-expense", refId: wo.ref, label: "Add a cost" },
            { key: "cancel-work-order", refId: wo.ref },
          ]
        : wo.status === "PENDING_CLOSE"
          ? [{ key: "approve-closure", refId: wo.ref }]
          : wo.status === "CLOSED" && releasable
            ? [{ key: "release-to-service", refId: wo.ref }]
            : [];
  const targets: DetailRef[] = [
    { kind: "workOrder", ref: wo.ref },
    ...(wo.issueRef ? [{ kind: "issue", ref: wo.issueRef } as const] : []),
    ...wo.costLines.flatMap((c) => (c.entryNumber ? [{ kind: "entry", ref: c.entryNumber } as const] : [])),
  ];

  return (
    <DetailLayout
      back={back}
      eyebrow="Work order"
      title={`${wo.ref} · ${wo.title}`}
      tags={
        <>
          <Tag tone={WO_TONE[wo.status]}>{WORK_ORDER_STATUS_LABELS[wo.status]}</Tag>
          {wo.safetyCritical && (
            <Tag tone="critical" icon={ShieldAlert}>
              Safety-critical
            </Tag>
          )}
        </>
      }
      ctx={ctx}
      run={run}
      footer={[...byStatus, { key: "add-note", refId: wo.ref }]}
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label="From problem" value={wo.issueRef ? <RefLink ctx={ctx} to={{ kind: "issue", ref: wo.issueRef }} /> : "None, planned work"} />
        <Fact label="Assigned to" value={wo.assignee} />
        <Fact label="Opened" value={shortDate(wo.createdAt)} sub={`by ${wo.createdBy}`} />
        <Fact label="Due" value={wo.dueBy ? formatDate(wo.dueBy) : "No date"} sub={due && (wo.status === "OPEN" || wo.status === "SUBMITTED") ? due.text : null} />
        <Fact label="Expected cost" value={wo.expectedCostMinor !== null ? formatXaf(wo.expectedCostMinor) : "Not set"} />
        <Fact label="Actual cost" value={wo.actualCostMinor !== null ? formatXaf(wo.actualCostMinor) : "Not yet"} sub={wo.completedBy ? `completed by ${wo.completedBy}` : null} />
      </dl>

      {wo.summary && (
        <DetailSection title={wo.status === "CANCELLED" ? "Why it was cancelled" : "What was done"}>
          <p className="rounded-md bg-muted px-3 py-2 text-sm">{wo.summary}</p>
        </DetailSection>
      )}

      <DetailSection
        title="Checklist"
        aside={
          total > 0 ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {done} of {total} done
            </span>
          ) : null
        }
      >
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">No checklist on this work order.</p>
        ) : (
          <>
            <ul className="divide-y rounded-lg border">
              {wo.checklist.map((c, i) => {
                const checked = list[i] ?? c.done;
                return (
                  <li key={c.label}>
                    <label className={cn("flex items-center gap-3 px-3 py-2.5 text-sm", canTick && "cursor-pointer hover:bg-muted/50")}>
                      <Checkbox checked={checked} disabled={!canTick} onCheckedChange={() => ctx.toggle(wo.ref, i)} />
                      <span className={cn(checked && "text-muted-foreground line-through decoration-foreground/30")}>{c.label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {wo.status === "OPEN" && !canTick && <p className="mt-2 text-xs text-muted-foreground">Only the workshop ticks steps.</p>}
          </>
        )}
      </DetailSection>

      <DetailSection title="Costs" aside={<span className="text-xs text-muted-foreground tabular-nums">{formatXaf(recorded)} on this order</span>}>
        {wo.costLines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No costs recorded against this work order.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {wo.costLines.map((c) => (
              <li key={c.label} className="flex items-start gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{c.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {c.kind} ·{" "}
                    {c.entryNumber ? <RefLink ctx={ctx} to={{ kind: "entry", ref: c.entryNumber }} className="text-foreground" /> : "no expense entry, not in vehicle totals"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-medium tabular-nums">{formatXaf(c.amountMinor)}</span>
                  {c.entryStatus && <Tag tone={ENTRY_TONE[c.entryStatus]}>{ENTRY_STATUS_LABELS[c.entryStatus]}</Tag>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      <Chronology ctx={ctx} targets={targets} />
    </DetailLayout>
  );
}

function IssueDetail({ ctx, id, run, back }: DetailProps) {
  const { ws } = ctx;
  const issue = ws.issues.find((i) => i.ref === id);
  if (!issue) return <NotFound back={back} what={id} />;
  const grounding = ws.readiness.state === "GROUNDED" && ws.readiness.issueRef === issue.ref;
  const targets: DetailRef[] = [{ kind: "issue", ref: issue.ref }, ...(issue.workOrderRef ? [{ kind: "workOrder", ref: issue.workOrderRef } as const] : [])];
  const footer: FooterAction[] = [...(issue.status === "OPEN" ? [{ key: "create-work-order" as const, refId: issue.ref }] : []), { key: "add-note", refId: issue.ref }];
  return (
    <DetailLayout
      back={back}
      eyebrow="Reported problem"
      title={`${issue.ref} · ${issue.title}`}
      tags={
        <>
          <Tag tone={ISSUE_TONE[issue.status]}>{ISSUE_STATUS_LABELS[issue.status]}</Tag>
          {issue.safetyCritical && (
            <Tag tone="critical" icon={ShieldAlert}>
              Safety-critical
            </Tag>
          )}
          {grounding && (
            <Tag tone="critical" icon={OctagonX}>
              Grounds the vehicle
            </Tag>
          )}
        </>
      }
      ctx={ctx}
      run={run}
      footer={footer}
    >
      <p className="rounded-md bg-muted px-3 py-2 text-sm">{issue.description}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label="Reported by" value={issue.reportedBy} sub={formatDateTime(issue.reportedAt)} />
        <Fact label="Category" value={issue.category} />
        <Fact label="Work order" value={issue.workOrderRef ? <RefLink ctx={ctx} to={{ kind: "workOrder", ref: issue.workOrderRef }} /> : "None yet"} />
        <Fact label="Effect" value={grounding ? "Grounded" : issue.safetyCritical ? "Safety-critical" : "Can still run"} sub={grounding ? "Until a manager releases it" : null} />
      </dl>
      <DetailSection title="Photos">
        {issue.photos === 0 ? (
          <p className="text-sm text-muted-foreground">No photo attached.</p>
        ) : (
          <div className="flex gap-2">
            {Array.from({ length: issue.photos }, (_, i) => (
              <div key={i} className="flex size-20 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                <Camera className="size-5" aria-hidden />
                <span className="sr-only">Photo {i + 1}</span>
              </div>
            ))}
          </div>
        )}
      </DetailSection>
      <Chronology ctx={ctx} targets={targets} />
    </DetailLayout>
  );
}

function EntryDetail({ ctx, id, run, back }: DetailProps) {
  const e = ctx.ws.entries.find((x) => x.number === id);
  if (!e) return <NotFound back={back} what={id} />;
  const link = entryLinkTarget(e);
  const footer: FooterAction[] = [
    ...(e.status === "SUBMITTED" ? [{ key: "review-entry" as const, refId: e.number }] : []),
    ...(e.evidence === "MISSING" ? [{ key: "attach-receipt" as const, refId: e.number }] : []),
    ...(e.status === "POSTED" ? [{ key: "reverse-entry" as const, refId: e.number }] : []),
  ];
  return (
    <DetailLayout
      back={back}
      eyebrow={e.direction === "REVENUE" ? "Revenue entry" : "Expense entry"}
      title={`${e.number} · ${e.category}`}
      tags={
        <>
          <Tag tone={ENTRY_TONE[e.status]}>{ENTRY_STATUS_LABELS[e.status]}</Tag>
          {e.evidence === "MISSING" ? (
            <Tag tone="warning" icon={Receipt}>
              No receipt
            </Tag>
          ) : (
            <Tag icon={Receipt}>Receipt attached</Tag>
          )}
        </>
      }
      ctx={ctx}
      run={run}
      footer={footer}
    >
      <div>
        <p className="text-3xl font-semibold tabular-nums">{formatXaf(e.amountMinor, { signed: e.direction === "REVENUE" })}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {e.amountMinor === e.entryTotalMinor ? "All of this entry is on this vehicle." : `This vehicle's share of a ${formatXaf(e.entryTotalMinor)} entry split across vehicles.`}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label="Economic date" value={formatDate(e.economicDate)} />
        <Fact label="Layer" value={LAYER_LABELS[e.layer]} />
        <Fact label="Counterparty" value={e.counterparty ?? "Not recorded"} />
        <Fact label="Recorded by" value={e.recordedBy} />
        <Fact
          label="Linked to"
          value={link ? <RefLink ctx={ctx} to={link} /> : "Nothing"}
          sub={e.link ? (e.link.kind === "WORK_ORDER" ? "Work order" : e.link.kind === "TRIP" ? "Trip" : "Document") : null}
        />
        <Fact label="Evidence" value={e.evidence === "ATTACHED" ? "Supplied" : "Not supplied"} sub="Verification not recorded" />
      </dl>
      <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        {e.status === "SUBMITTED" ? "Awaiting review, so not in posted totals. " : ""}Posted is not paid. A correction is a reversal; this entry stays in history.
      </p>
      <Chronology ctx={ctx} targets={[{ kind: "entry", ref: e.number }]} />
    </DetailLayout>
  );
}

function TripDetail({ ctx, id, run, back }: DetailProps) {
  const { ws } = ctx;
  const t = ws.trips.find((x) => x.number === id);
  if (!t) return <NotFound back={back} what={id} />;
  const linked = ws.entries.filter((e) => e.link?.kind === "TRIP" && e.link.ref === t.number);
  const end = t.endedAt ?? `${TODAY}T23:59:59Z`;
  const readings = ws.readings.filter((r) => r.observedAt >= t.startedAt && r.observedAt <= end);
  const targets: DetailRef[] = [{ kind: "trip", ref: t.number }, ...linked.map((e) => ({ kind: "entry", ref: e.number }) as const)];
  return (
    <DetailLayout
      back={back}
      eyebrow="Trip"
      title={`${t.number} · ${t.from} → ${t.to}`}
      tags={
        <>
          <Tag tone={t.status === "OPEN" ? "info" : "neutral"}>{t.status === "OPEN" ? "Open" : "Closed"}</Tag>
          {t.exceptions > 0 && (
            <Tag tone="warning" icon={TriangleAlert}>
              {plural(t.exceptions, "exception")}
            </Tag>
          )}
        </>
      }
      ctx={ctx}
      run={run}
      footer={[
        { key: "log-fuel", refId: t.number },
        { key: "record-expense", refId: t.number },
      ]}
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label="Type" value={t.type} />
        <Fact label="Customer" value={t.customer ?? "None"} />
        <Fact label="Driver" value={t.driver} sub="Not necessarily the custodian" />
        <Fact label="Distance" value={t.distanceKm !== null ? km(t.distanceKm) : "Not closed"} />
        <Fact label="Started" value={formatDateTime(t.startedAt)} />
        <Fact label="Ended" value={t.endedAt ? formatDateTime(t.endedAt) : "Still open"} />
        <Fact label="Revenue" value={t.revenueMinor !== null ? formatXaf(t.revenueMinor) : "None recorded"} />
        <Fact label="Costs" value={t.costMinor > 0 ? formatXaf(t.costMinor) : "None recorded"} />
      </dl>
      <DetailSection title="Money on this trip">
        {linked.length === 0 ? (
          <p className="text-sm text-muted-foreground">No entries linked in this sample.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {linked.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <RefLink ctx={ctx} to={{ kind: "entry", ref: e.number }} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{e.category}</span>
                <span className="tabular-nums">{formatXaf(e.amountMinor, { signed: e.direction === "REVENUE" })}</span>
              </li>
            ))}
          </ul>
        )}
      </DetailSection>
      <DetailSection title="Odometer readings">
        {readings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No readings during this trip.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {readings.map((r) => (
              <li key={r.id} className="flex justify-between gap-3">
                <span className="tabular-nums">{km(r.valueKm)}</span>
                <span className="text-muted-foreground">
                  {r.source} · {formatDateTime(r.observedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DetailSection>
      <Chronology ctx={ctx} targets={targets} />
    </DetailLayout>
  );
}

function DocumentDetail({ ctx, id, run, back }: DetailProps) {
  const d = ctx.ws.documents.find((x) => x.id === id);
  if (!d) return <NotFound back={back} what={id} />;
  const st = docStatus(d);
  return (
    <DetailLayout
      back={back}
      eyebrow="Document"
      title={d.type}
      tags={<Tag tone={st.tone}>{st.label}</Tag>}
      ctx={ctx}
      run={run}
      footer={d.expiresAt ? [{ key: "renew-document", refId: d.id }] : []}
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label="Number" value={d.number ?? "Not recorded"} />
        <Fact label="Issued" value={d.issuedAt ? formatDate(d.issuedAt) : "Unknown"} />
        <Fact label="Expires" value={d.expiresAt ? formatDate(d.expiresAt) : "No expiry date"} sub={d.state === "EXPIRED" ? "It cannot legally run" : null} />
        <Fact label="Scan" value={d.hasFile ? "Attached" : "Not on file"} />
        <Fact label="Earlier versions" value={d.previousVersions > 0 ? `${d.previousVersions} kept` : "None"} sub="A renewal supersedes; nothing is replaced" />
      </dl>
      <Chronology ctx={ctx} targets={[{ kind: "document", ref: d.id }]} />
    </DetailLayout>
  );
}
