// PROTOTYPE — throwaway, issue #44. Variant A: the tabbed workspace.
// A persistent vehicle header, what needs attention first, then one line-tab
// per domain. Every action lives in the section it belongs to; every ref opens
// the record it names.

import { Fragment, useState, type ReactNode } from "react";
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
  CircleDot,
  CircleX,
  ClipboardCheck,
  ClipboardPlus,
  Clock,
  Ellipsis,
  Eye,
  FileText,
  Flag,
  Gauge,
  Info,
  OctagonAlert,
  Paperclip,
  Receipt,
  Route,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { ACTIONS, actionByKey, useVehicleActions, type ActionGroup, type ActionKey } from "./actions.js";
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
  type Readiness,
  type TimelineEvent,
  type TimelineKind,
  type Trip,
  type VehicleDocument,
  type VehicleWorkspace,
  type WorkOrder,
  type WorkOrderStatus,
} from "./mockData.js";

// ---------------------------------------------------------------------------
// Types, vocabulary, helpers

type Tone = "neutral" | "success" | "warning" | "info" | "danger";
type TabKey = "overview" | "maintenance" | "trips" | "money" | "documents" | "history";
type RefHint = "entry" | "trip";

type Detail =
  | { kind: "work-order"; ref: string }
  | { kind: "issue"; ref: string }
  | { kind: "entry"; number: string }
  | { kind: "trip"; number: string }
  | { kind: "document"; id: string }
  | { kind: "readings" };

interface Ctx {
  ws: VehicleWorkspace;
  role: ProtoRole;
  readOnly: boolean;
  byGroup: ReturnType<typeof useVehicleActions>["byGroup"];
  can: (key: ActionKey) => boolean;
  act: (key: ActionKey, ref?: string | null) => void;
  show: (detail: Detail) => void;
  goTo: (tab: TabKey) => void;
}

interface Step {
  key: ActionKey;
  label: string;
  ref: string | null;
}

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

/** The one button in the header: the thing this role does most on a vehicle. */
const PRIMARY: Record<ProtoRole, ActionKey | null> = {
  ADMIN: "record-expense",
  OPS_MANAGER: "record-expense",
  FINANCE_APPROVER: "record-expense",
  MAINTENANCE: "report-issue",
  FIELD_SUBMITTER: "report-issue",
  EXECUTIVE_VIEWER: null,
};
const SECONDARY: Record<ProtoRole, ActionKey | null> = {
  ADMIN: null,
  OPS_MANAGER: null,
  FINANCE_APPROVER: null,
  MAINTENANCE: null,
  FIELD_SUBMITTER: "log-fuel",
  EXECUTIVE_VIEWER: null,
};
const GROUP_FIRST: Record<ProtoRole, ActionGroup | null> = {
  ADMIN: null,
  OPS_MANAGER: null,
  FINANCE_APPROVER: "Money",
  MAINTENANCE: "Maintenance",
  FIELD_SUBMITTER: "Capture",
  EXECUTIVE_VIEWER: null,
};

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
function daysFromToday(iso: string): number {
  return Math.round((Date.parse(`${iso.slice(0, 10)}T12:00:00`) - Date.parse(`${TODAY}T12:00:00`)) / 86_400_000);
}
function dueLabel(iso: string): string {
  const d = daysFromToday(iso);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d > 1) return `in ${d} days`;
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

function nextWoStep(ws: VehicleWorkspace, wo: WorkOrder): Step | null {
  switch (wo.status) {
    case "SUBMITTED":
      return { key: "approve-work-order", label: "Authorize", ref: wo.ref };
    case "OPEN":
      return { key: "complete-work-order", label: "Complete work", ref: wo.ref };
    case "PENDING_CLOSE":
      return { key: "approve-closure", label: "Sign off", ref: wo.ref };
    case "CLOSED":
      return ws.readiness.state === "GROUNDED" && ws.readiness.workOrderRef === wo.ref
        ? { key: "release-to-service", label: "Release to service", ref: wo.ref }
        : null;
    case "CANCELLED":
      return null;
  }
}

function entryActions(e: MoneyEntry): Step[] {
  const steps: Step[] = [];
  if (e.evidence === "MISSING") steps.push({ key: "attach-receipt", label: "Attach receipt", ref: e.number });
  if (e.status === "SUBMITTED") steps.push({ key: "review-entry", label: "Review", ref: e.number });
  if (e.status === "POSTED") steps.push({ key: "reverse-entry", label: "Reverse", ref: e.number });
  return steps;
}

const isActiveWo = (w: WorkOrder) => w.status !== "CLOSED" && w.status !== "CANCELLED";
const isOpenIssue = (i: Issue) => i.status === "OPEN" || i.status === "IN_WORK";

// ---------------------------------------------------------------------------
// Page

export function VariantA({ ws }: { ws: VehicleWorkspace }) {
  const actions = useVehicleActions(ws);
  const [tab, setTab] = useState<TabKey>("overview");
  const [stack, setStack] = useState<Detail[]>([]);
  const [ticks, setTicks] = useState<Record<string, boolean[]>>({});

  const ctx: Ctx = {
    ws,
    role: actions.role,
    readOnly: actions.available.length === 0,
    byGroup: actions.byGroup,
    can: actions.can,
    act: (key, ref = null) => {
      setStack([]);
      actions.open(key, ref);
    },
    show: (detail) => setStack((s) => [...s, detail]),
    goTo: (next) => {
      setTab(next);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  };

  const openCount = ws.workOrders.filter(isActiveWo).length + ws.issues.filter((i) => i.status === "OPEN" && !i.workOrderRef).length;
  const expired = ws.documents.filter((d) => d.state === "EXPIRED").length;
  const expiring = ws.documents.filter((d) => d.state === "EXPIRING").length;

  return (
    <PageContainer width="wide" className="pb-28">
      <VehicleHeader ctx={ctx} />

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)} className="mt-6 gap-5">
        <div className="sticky top-14 z-[5] -mx-4 overflow-x-auto bg-background px-4 shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none] sm:mx-0 sm:px-0">
          <TabsList variant="line" className="h-11 w-max gap-5 p-0">
            <TabItem value="overview" label="Overview" />
            <TabItem value="maintenance" label="Maintenance" count={openCount > 0 ? <Count>{openCount}<span className="hidden sm:inline">&nbsp;open</span></Count> : null} />
            <TabItem value="trips" label="Trips" count={<Count>{ws.trips.length}</Count>} />
            <TabItem value="money" label="Money" />
            <TabItem
              value="documents"
              label="Documents"
              count={
                expired > 0 ? (
                  <Count tone="danger">{expired}<span className="hidden sm:inline">&nbsp;expired</span></Count>
                ) : expiring > 0 ? (
                  <Count tone="warning">{expiring}<span className="hidden sm:inline">&nbsp;expiring</span></Count>
                ) : null
              }
            />
            <TabItem value="history" label="History" count={<Count>{ws.timeline.length}</Count>} />
          </TabsList>
        </div>

        <TabsContent value="overview">
          <OverviewTab ctx={ctx} />
        </TabsContent>
        <TabsContent value="maintenance">
          <MaintenanceTab ctx={ctx} />
        </TabsContent>
        <TabsContent value="trips">
          <TripsTab ctx={ctx} />
        </TabsContent>
        <TabsContent value="money">
          <MoneyTab ctx={ctx} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsTab ctx={ctx} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab ctx={ctx} />
        </TabsContent>
      </Tabs>

      <DetailSheet
        ctx={ctx}
        stack={stack}
        onBack={() => setStack((s) => s.slice(0, -1))}
        onClose={() => setStack([])}
        ticks={ticks}
        onTick={(ref, index, done) =>
          setTicks((t) => {
            const wo = ws.workOrders.find((w) => w.ref === ref);
            const current = t[ref] ?? wo?.checklist.map((c) => c.done) ?? [];
            const next = [...current];
            next[index] = done;
            return { ...t, [ref]: next };
          })
        }
      />
      {actions.sheet}
    </PageContainer>
  );
}

function TabItem({ value, label, count }: { value: TabKey; label: string; count?: ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      className="h-full flex-none gap-2 px-0.5 text-sm group-data-horizontal/tabs:after:bottom-0"
    >
      {label}
      {count}
    </TabsTrigger>
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

function Count({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "danger" | "warning" }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md px-1.5 text-xs font-medium tabular-nums",
        tone === "neutral" && "bg-muted text-muted-foreground",
        tone === "danger" && "bg-destructive/10 text-destructive",
        tone === "warning" && "bg-warning/15 text-warning-foreground",
      )}
    >
      {children}
    </span>
  );
}

function RefButton({ ctx, refId, hint, className }: { ctx: Ctx; refId: string; hint?: RefHint; className?: string }) {
  const detail = resolveRef(ctx.ws, refId, hint);
  if (!detail) return <span className={cn("tabular-nums", className)}>{refId}</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        ctx.show(detail);
      }}
      className={cn(
        "rounded-sm font-medium text-foreground tabular-nums underline decoration-foreground/25 underline-offset-[3px] transition-colors hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      {detailLabel(ctx.ws, detail)}
    </button>
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

function SafetyMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
      <ShieldAlert className="size-3.5" aria-hidden />
      {compact ? <span className="sr-only">Safety-critical</span> : "Safety-critical"}
    </span>
  );
}

function Evidence({ state }: { state: MoneyEntry["evidence"] }) {
  return state === "ATTACHED" ? (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Paperclip className="size-3.5" aria-hidden />
      Receipt
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
          Expired {doc.daysLeft !== null ? `${-doc.daysLeft} days ago` : ""}
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

function SectionHeader({ title, count, description, actions }: { title: string; count?: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          {title}
          {count}
        </h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

function ActionButton({ ctx, step, variant = "outline", size = "sm", className }: { ctx: Ctx; step: Step; variant?: "default" | "outline" | "ghost"; size?: "sm" | "default" | "xs"; className?: string }) {
  if (!ctx.can(step.key)) return null;
  const Icon = actionByKey(step.key).icon;
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        ctx.act(step.key, step.ref);
      }}
    >
      <Icon aria-hidden />
      {step.label}
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

function Stat({ label, value, hint, tone = "neutral", info }: { label: string; value: string; hint: ReactNode; tone?: "neutral" | "warning"; info?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-card p-3 ring-1 ring-foreground/10 sm:p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {tone === "warning" && <TriangleAlert className="size-3.5 text-amber-600 dark:text-amber-400" aria-hidden />}
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

// ---------------------------------------------------------------------------
// Header

function VehicleHeader({ ctx }: { ctx: Ctx }) {
  const { ws } = ctx;
  const v = ws.vehicle;
  const makeModel = [v.make, v.model].filter(Boolean).join(" ");
  const title = v.displayName !== v.code ? v.displayName : makeModel || v.code;
  const describe = makeModel && makeModel !== title ? `${makeModel}${v.year ? `, ${v.year}` : ""}` : v.year ? `Model year ${v.year}` : null;

  return (
    <header className="space-y-3">
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
          <div className="flex min-w-0 items-start gap-3.5">
            <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted text-foreground/80">
              <Truck className="size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
                {title !== v.code && <span className="text-sm font-medium text-muted-foreground tabular-nums">{v.code}</span>}
              </div>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                {v.plate ? (
                  <span className="rounded-[5px] border border-foreground/25 px-1.5 text-xs font-semibold tracking-wide text-foreground tabular-nums">{v.plate}</span>
                ) : (
                  <span>Plate not recorded</span>
                )}
                <Sep />
                <span>{v.classLabel}</span>
                {describe && (
                  <>
                    <Sep />
                    <span>{describe}</span>
                  </>
                )}
              </p>
            </div>
          </div>
          <HeaderActions ctx={ctx} />
        </div>
        <FactGrid ctx={ctx} />
      </Card>
      {ws.readiness.state === "GROUNDED" && <GroundedStrip ctx={ctx} readiness={ws.readiness} />}
    </header>
  );
}

function HeaderActions({ ctx }: { ctx: Ctx }) {
  if (ctx.readOnly) {
    return (
      <span className="inline-flex items-center gap-1.5 self-start rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
        <Eye className="size-3.5" aria-hidden />
        View only
      </span>
    );
  }
  const primary = PRIMARY[ctx.role];
  const secondary = SECONDARY[ctx.role];
  return (
    <div className="flex items-center gap-2 sm:shrink-0">
      {secondary && ctx.can(secondary) && <HeaderButton ctx={ctx} actionKey={secondary} variant="outline" />}
      {primary && ctx.can(primary) && <HeaderButton ctx={ctx} actionKey={primary} variant="default" />}
      <ActionsMenu ctx={ctx} />
    </div>
  );
}

function HeaderButton({ ctx, actionKey, variant }: { ctx: Ctx; actionKey: ActionKey; variant: "default" | "outline" }) {
  const a = actionByKey(actionKey);
  return (
    <Button variant={variant} className="h-10 flex-1 sm:h-9 sm:flex-none" onClick={() => ctx.act(actionKey)}>
      <a.icon aria-hidden />
      {a.label}
    </Button>
  );
}

function ActionsMenu({ ctx }: { ctx: Ctx }) {
  const first = GROUP_FIRST[ctx.role];
  const groups = first ? [...ctx.byGroup].sort((a, b) => Number(b.group === first) - Number(a.group === first)) : ctx.byGroup;
  const total = groups.reduce((n, g) => n + g.actions.length, 0);
  // Two columns once the list would run past a laptop fold; split where the halves balance.
  const columns: Array<typeof groups> = [[], []];
  let running = 0;
  for (const g of groups) {
    const col = total > 10 && running >= total / 2 - 1 ? 1 : 0;
    columns[col]?.push(g);
    running += g.actions.length;
  }
  const wide = (columns[1]?.length ?? 0) > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" className="h-10 sm:h-9" aria-label="All actions" />}>
        <span className="hidden sm:inline">Actions</span>
        <ChevronDown className="hidden sm:block" aria-hidden />
        <Ellipsis className="sm:hidden" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn("w-64", wide && "sm:w-[33rem]")}>
        <div className={cn("grid", wide && "sm:grid-cols-2 sm:gap-x-1 sm:divide-x sm:divide-border")}>
          {columns.map((col, c) =>
            col.length === 0 ? null : (
              <div key={c} className={cn(c === 1 && "max-sm:mt-1 max-sm:border-t max-sm:pt-1 sm:pl-1")}>
                {col.map((g, i) => (
                  <DropdownMenuGroup key={g.group} className={cn(i > 0 && "mt-1 border-t pt-1")}>
                    <DropdownMenuLabel>{g.group}</DropdownMenuLabel>
                    {g.actions.map((a) => (
                      <DropdownMenuItem key={a.key} onClick={() => ctx.act(a.key)}>
                        <a.icon className="text-muted-foreground" aria-hidden />
                        {a.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                ))}
              </div>
            ),
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Fact({ label, value, sub, action }: { label: string; value: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="min-w-0 bg-card px-4 py-3">
      <dt className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        {action}
      </dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-muted-foreground">{sub}</dd>}
    </div>
  );
}

function FactLink({ ctx, actionKey, label }: { ctx: Ctx; actionKey: ActionKey; label: string }) {
  if (!ctx.can(actionKey)) return null;
  return (
    <button
      type="button"
      onClick={() => ctx.act(actionKey)}
      className="rounded-sm text-xs font-medium text-foreground/60 underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      {label}
    </button>
  );
}

function FactGrid({ ctx }: { ctx: Ctx }) {
  const { ws } = ctx;
  const v = ws.vehicle;
  const r = ws.readiness;
  return (
    <dl className="grid grid-cols-2 gap-px border-t bg-border sm:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_1fr_1.45fr_1fr]">
      <Fact
        label="Lifecycle"
        value={LIFECYCLE_LABELS[v.lifecycle] ?? v.lifecycle}
        sub={v.commissionedAt ? `Since ${formatDate(v.commissionedAt)}` : "Not commissioned"}
      />
      <Fact
        label="Readiness"
        value={
          r.state === "GROUNDED" ? (
            <span className="inline-flex items-center gap-1.5 text-destructive">
              <ShieldAlert className="size-4" aria-hidden />
              Grounded
            </span>
          ) : r.state === "AVAILABLE" ? (
            <span className="inline-flex items-center gap-1.5 text-success-foreground">
              <CircleCheck className="size-4" aria-hidden />
              Available
            </span>
          ) : (
            <span className="text-muted-foreground">Not assessed</span>
          )
        }
        sub={r.state === "NOT_ASSESSED" ? "No availability record" : `Since ${formatDateTime(r.since)}`}
      />
      <Fact
        label="Home branch"
        value={v.homeBranch.name}
        sub="Administrative home"
        action={<FactLink ctx={ctx} actionKey="transfer-branch" label="Transfer" />}
      />
      <Fact
        label="Custodian"
        value={ws.custodian ? ws.custodian.name : <span className="text-muted-foreground">None assigned</span>}
        sub={ws.custodian ? `${ws.custodian.kind} · since ${shortDay(ws.custodian.since)}` : "Accountable person"}
        action={<FactLink ctx={ctx} actionKey="assign-custodian" label="Change" />}
      />
      <Fact
        label="Reported location"
        value={ws.location.state === "REPORTED" ? ws.location.place : <span className="text-muted-foreground">No report</span>}
        sub={ws.location.state === "REPORTED" ? `${formatDateTime(ws.location.observedAt)} · ${ws.location.source}` : "Reported by people, not GPS"}
        action={<FactLink ctx={ctx} actionKey="report-location" label="Report" />}
      />
      <Fact
        label="Odometer"
        value={
          <button
            type="button"
            onClick={() => ctx.show({ kind: "readings" })}
            className="rounded-sm tabular-nums underline decoration-foreground/25 underline-offset-[3px] hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {km(ws.meter.odometerKm)}
          </button>
        }
        sub={`${shortDay(ws.meter.observedAt)} · ${ws.meter.source.toLowerCase()} · ${ws.meter.observedBy}`}
        action={<FactLink ctx={ctx} actionKey="record-reading" label="Record" />}
      />
    </dl>
  );
}

function GroundedStrip({ ctx, readiness }: { ctx: Ctx; readiness: Extract<Readiness, { state: "GROUNDED" }> }) {
  const { ws } = ctx;
  const wo = readiness.workOrderRef ? ws.workOrders.find((w) => w.ref === readiness.workOrderRef) : undefined;
  const status = wo?.status;
  const steps: Array<{ label: string; state: "done" | "current" | "upcoming" }> = [
    {
      label: wo ? `${wo.ref} ${WORK_ORDER_STATUS_LABELS[wo.status].toLowerCase()}` : "Work order to create",
      state: !wo || status === "SUBMITTED" || status === "OPEN" ? "current" : "done",
    },
    { label: "Sign-off", state: status === "PENDING_CLOSE" ? "current" : status === "CLOSED" ? "done" : "upcoming" },
    { label: "Release by a manager", state: status === "CLOSED" ? "current" : "upcoming" },
  ];
  const next: Step | null = wo ? nextWoStep(ws, wo) : { key: "create-work-order", label: "Create work order", ref: readiness.issueRef };

  return (
    <div role="status" className="rounded-xl border border-destructive/25 bg-destructive/[0.04] p-4 dark:bg-destructive/10">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div className="flex min-w-0 gap-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 space-y-1.5">
            <p className="font-medium text-destructive">
              Grounded since {formatDateTime(readiness.since)}: {readiness.reason}
            </p>
            <p className="text-sm text-muted-foreground">
              Safety-critical report <RefButton ctx={ctx} refId={readiness.issueRef} /> by {readiness.reportedBy}. It stays grounded until a manager releases it after the
              work is signed off.
            </p>
            <ol className="flex flex-col gap-1 pt-0.5 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2" aria-label="Release path">
              {steps.map((s, i) => (
                <li key={s.label} className="flex items-center gap-2">
                  {i > 0 && <ChevronRight className="hidden size-3.5 text-muted-foreground/60 sm:block" aria-hidden />}
                  <span className={cn("inline-flex items-center gap-1.5", s.state === "current" ? "font-medium text-foreground" : "text-muted-foreground")}>
                    {s.state === "done" ? (
                      <CircleCheck className="size-3.5 text-success-foreground" aria-hidden />
                    ) : s.state === "current" ? (
                      <CircleDot className="size-3.5 text-destructive" aria-hidden />
                    ) : (
                      <Circle className="size-3.5" aria-hidden />
                    )}
                    {s.label}
                    {s.state === "current" && <span className="sr-only">(current step)</span>}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pl-8 lg:shrink-0 lg:pl-0">
          {wo && (
            <Button variant="outline" size="sm" className="bg-background" onClick={() => ctx.show({ kind: "work-order", ref: wo.ref })}>
              Open {wo.ref}
            </Button>
          )}
          {next && <ActionButton ctx={ctx} step={next} variant="default" />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview

function OverviewTab({ ctx }: { ctx: Ctx }) {
  const { ws } = ctx;
  const m = ws.money;
  return (
    <div className="space-y-6">
      <AttentionCard ctx={ctx} />

      <section>
        <div className="mb-2.5 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{m.periodLabel}</h2>
            <p className="text-xs text-muted-foreground">This vehicle's share of posted entries</p>
          </div>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => ctx.goTo("money")}>
            Money details
            <ArrowRight aria-hidden />
          </Button>
        </div>
        <PeriodStats ctx={ctx} />
      </section>

      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        <Card className="gap-0 py-0 lg:col-span-2">
          <CardHead
            title="Latest activity"
            aside={
              <Button variant="ghost" size="sm" className="-my-1 text-muted-foreground" onClick={() => ctx.goTo("history")}>
                See full history
                <ArrowRight aria-hidden />
              </Button>
            }
          />
          <ol className="divide-y">
            {ws.timeline.slice(0, 5).map((e) => (
              <EventRow key={e.id} ctx={ctx} event={e} timeMode="datetime" />
            ))}
          </ol>
        </Card>
        <DetailsCard ctx={ctx} />
      </div>
    </div>
  );
}

function PeriodStats({ ctx }: { ctx: Ctx }) {
  const m = ctx.ws.money;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Posted expenses" value={formatXaf(m.postedExpenseMinor)} hint="All layers · posted is not paid" />
      <Stat
        label="Awaiting review"
        value={formatXaf(m.pendingReviewMinor)}
        hint={`${plural(m.pendingReviewCount, "entry", "entries")} · not in posted`}
        tone={m.pendingReviewCount > 0 ? "warning" : "neutral"}
      />
      <Stat
        label="Missing receipts"
        value={plural(m.missingEvidenceCount, "entry", "entries")}
        hint="Recorded without proof"
        tone={m.missingEvidenceCount > 0 ? "warning" : "neutral"}
      />
      {m.costPerKm ? (
        <Stat label="Cost per km" value={`${m.costPerKm.minor.toLocaleString("en-US")} XAF/km`} hint={`Over ${km(ctx.ws.meter.km30d)} between readings`} info={m.costPerKm.basis} />
      ) : (
        <Stat label="Cost per km" value="Not enough data" hint="Needs start and end readings" />
      )}
    </div>
  );
}

const SEVERITY_RANK: Record<AttentionItem["severity"], number> = { critical: 0, warning: 1, info: 2 };

/** The seeded list, plus facts the list does not carry yet (a problem nobody has planned work for). */
function attentionItems(ws: VehicleWorkspace): AttentionItem[] {
  const derived: AttentionItem[] = ws.issues
    .filter((i) => i.status === "OPEN" && !i.workOrderRef && !ws.attention.some((a) => a.ref === i.ref))
    .map((i) => ({
      id: `derived-${i.id}`,
      severity: i.safetyCritical ? "critical" : "warning",
      title: `${i.ref} has no work order`,
      detail: `${i.title}. Reported by ${i.reportedBy}, ${relativeDays(i.reportedAt)}.`,
      actionKey: "create-work-order",
      actionLabel: "Create work order",
      ref: i.ref,
    }));
  return [...ws.attention, ...derived].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** Can this role do the thing the item asks for? Opening a work order counts when the role can take its next step. */
function canActOn(ctx: Ctx, item: AttentionItem): boolean {
  const key = item.actionKey;
  if (key === "open-work-order") {
    const wo = ctx.ws.workOrders.find((w) => w.ref === item.ref);
    const next = wo ? nextWoStep(ctx.ws, wo) : null;
    return next !== null && ctx.can(next.key);
  }
  return isActionKey(key) && ctx.can(key);
}

function AttentionCard({ ctx }: { ctx: Ctx }) {
  const items = attentionItems(ctx.ws);
  const mine = items.filter((i) => canActOn(ctx, i));
  const others = items.filter((i) => !canActOn(ctx, i));
  const split = mine.length > 0 && others.length > 0;
  return (
    <Card className="gap-0 py-0">
      <CardHead
        title={
          <>
            Needs attention <Count>{items.length}</Count>
          </>
        }
        description={split ? "What you can act on first, most urgent first" : "Most urgent first"}
      />
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Nothing needs attention on this vehicle.</p>
      ) : (
        <>
          <ul className="divide-y">
            {(split ? mine : items).map((item) => (
              <AttentionRow key={item.id} ctx={ctx} item={item} actionable={canActOn(ctx, item)} />
            ))}
          </ul>
          {split && (
            <>
              <h3 className="border-y bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">Also on this vehicle, handled by others</h3>
              <ul className="divide-y">
                {others.map((item) => (
                  <AttentionRow key={item.id} ctx={ctx} item={item} actionable={false} quiet />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Card>
  );
}

function AttentionRow({ ctx, item, actionable, quiet = false }: { ctx: Ctx; item: AttentionItem; actionable: boolean; quiet?: boolean }) {
  const Icon = item.severity === "critical" ? OctagonAlert : item.severity === "warning" ? TriangleAlert : Info;
  const detail = item.ref ? resolveRef(ctx.ws, item.ref) : null;
  const key = item.actionKey;
  let control: ReactNode = null;
  if (actionable && key === "open-work-order" && detail) {
    control = (
      <Button variant="outline" size="sm" onClick={() => ctx.show(detail)}>
        {item.actionLabel}
      </Button>
    );
  } else if (actionable && isActionKey(key)) {
    control = <ActionButton ctx={ctx} step={{ key, label: item.actionLabel, ref: item.ref }} />;
  } else if (detail) {
    control = (
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => ctx.show(detail)}>
        View
        <ChevronRight aria-hidden />
      </Button>
    );
  }
  const icon = (
    <Icon
      className={cn(
        "mt-0.5 size-4 shrink-0",
        item.severity === "critical" && "text-destructive",
        item.severity === "warning" && "text-amber-600 dark:text-amber-400",
        item.severity === "info" && "text-sky-600 dark:text-sky-400",
      )}
      aria-hidden
    />
  );
  if (quiet) {
    const body = (
      <>
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug">
            <span className="sr-only">{item.severity}: </span>
            {item.title}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{item.detail}</span>
        </span>
        {detail && <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
      </>
    );
    return (
      <li>
        {detail ? (
          <button type="button" onClick={() => ctx.show(detail)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40">
            {body}
          </button>
        ) : (
          <div className="flex items-start gap-3 px-4 py-2.5">{body}</div>
        )}
      </li>
    );
  }
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          item.severity === "critical" && "text-destructive",
          item.severity === "warning" && "text-amber-600 dark:text-amber-400",
          item.severity === "info" && "text-sky-600 dark:text-sky-400",
        )}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug">
            <span className="sr-only">{item.severity}: </span>
            {item.title}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">{item.detail}</p>
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
    </li>
  );
}

function DetailsCard({ ctx }: { ctx: Ctx }) {
  const v = ctx.ws.vehicle;
  const rows: Array<[string, ReactNode]> = [
    ["Fleet code", v.code],
    ["Plate", v.plate ?? "Not recorded"],
    ["Make and model", [v.make, v.model].filter(Boolean).join(" ") || "Not recorded"],
    ["Year", v.year ?? "Not recorded"],
    ["Class", v.classLabel],
    ["Chassis number", <span className="break-all">{v.chassis ?? "Not recorded"}</span>],
    ["Capacity", v.capacity ?? "Not recorded"],
    [
      "Acquired",
      v.acquisition.date
        ? `${formatDate(v.acquisition.date)}${v.acquisition.amountMinor !== null ? ` · ${formatXaf(v.acquisition.amountMinor)}` : ""}`
        : "Not recorded",
    ],
    ["Commissioned", v.commissionedAt ? formatDate(v.commissionedAt) : "Not commissioned"],
  ];
  return (
    <Card className="gap-0 py-0">
      <CardHead title="Vehicle details" />
      <dl className="divide-y text-sm">
        {rows.map(([k, val]) => (
          <div key={k} className="flex justify-between gap-4 px-4 py-2">
            <dt className="shrink-0 text-muted-foreground">{k}</dt>
            <dd className="text-right font-medium tabular-nums">{val}</dd>
          </div>
        ))}
      </dl>
      {v.specs.length > 0 && (
        <>
          <h3 className="border-y bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">Specifications</h3>
          <dl className="divide-y text-sm">
            {v.specs.map((s) => (
              <div key={s.label} className="flex justify-between gap-4 px-4 py-2">
                <dt className="shrink-0 text-muted-foreground">{s.label}</dt>
                <dd className="text-right font-medium">{s.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Timeline rows (overview, history, sheets)

function EventRow({ ctx, event, timeMode }: { ctx: Ctx; event: TimelineEvent; timeMode: "time" | "datetime" }) {
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
            <span className={cn("shrink-0 text-sm tabular-nums", event.amountMinor < 0 && "text-muted-foreground")}>
              {formatXaf(event.amountMinor, { signed })}
            </span>
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
          <time dateTime={event.at}>{timeMode === "time" ? timeOf(event.at) : formatDateTime(event.at)}</time>
          {event.ref && !refInText(ctx.ws, event.detail, event.ref, hint) && (
            <>
              <Sep />
              {hint ? <RefButton ctx={ctx} refId={event.ref} hint={hint} /> : <RefButton ctx={ctx} refId={event.ref} />}
            </>
          )}
        </p>
      </div>
    </li>
  );
}

function ChronologyRef({ ctx, refId, kind }: { ctx: Ctx; refId: string; kind: TimelineKind }) {
  const hint = REF_HINT[kind];
  return hint ? <RefButton ctx={ctx} refId={refId} hint={hint} className="font-normal" /> : <RefButton ctx={ctx} refId={refId} className="font-normal" />;
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
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          ctx.show(detail);
        }}
        className="rounded-sm font-medium text-foreground tabular-nums underline decoration-foreground/25 underline-offset-[3px] hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        {token}
      </button>
      {text.slice(at + token.length)}
    </>
  );
}

function Chronology({ ctx, events, currentRef }: { ctx: Ctx; events: TimelineEvent[]; currentRef: string }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">No recorded events yet.</p>;
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
                    <ChronologyRef ctx={ctx} refId={e.ref} kind={e.kind} />
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

// ---------------------------------------------------------------------------
// Maintenance

function MaintenanceTab({ ctx }: { ctx: Ctx }) {
  const { ws } = ctx;
  const [showDone, setShowDone] = useState(false);
  const openIssues = ws.issues.filter(isOpenIssue);
  const active = ws.workOrders.filter(isActiveWo);
  const doneWos = ws.workOrders.filter((w) => !isActiveWo(w));
  const doneIssues = ws.issues.filter((i) => !isOpenIssue(i));

  return (
    <div className="space-y-8">
      <section>
        <SectionHeader
          title="Open problems"
          count={<Count>{openIssues.length}</Count>}
          description="Reported by drivers and technicians. A safety-critical problem grounds the vehicle."
          actions={<ActionButton ctx={ctx} step={{ key: "report-issue", label: "Report a problem", ref: null }} />}
        />
        {openIssues.length === 0 ? (
          <EmptyState icon={<CircleCheck className="size-6" />} message="No open problems on this vehicle." />
        ) : (
          <Card className="gap-0 py-0">
            <ul className="divide-y">
              {openIssues.map((issue) => (
                <IssueRow key={issue.id} ctx={ctx} issue={issue} />
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section>
        <SectionHeader
          title="Work orders"
          count={<Count>{active.length}</Count>}
          description="Planned and running work. Costs are recorded as expenses linked to the order."
          actions={
            <>
              <ActionButton ctx={ctx} step={{ key: "schedule-service", label: "Schedule service", ref: null }} variant="ghost" />
              <ActionButton ctx={ctx} step={{ key: "create-work-order", label: "Create work order", ref: null }} />
            </>
          }
        />
        {active.length === 0 ? (
          <EmptyState icon={<Wrench className="size-6" />} message="No work in progress." />
        ) : (
          <WorkOrderList ctx={ctx} workOrders={active} />
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
            <div className="mt-3 space-y-4">
              <WorkOrderList ctx={ctx} workOrders={doneWos} muted />
              {doneIssues.length > 0 && (
                <Card className="gap-0 py-0">
                  <ul className="divide-y">
                    {doneIssues.map((issue) => (
                      <IssueRow key={issue.id} ctx={ctx} issue={issue} />
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function IssueRow({ ctx, issue }: { ctx: Ctx; issue: Issue }) {
  const done = !isOpenIssue(issue);
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {issue.safetyCritical ? (
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Safety-critical" />
        ) : done ? (
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        )}
        <div className="min-w-0">
          <p className="leading-snug">
            <RefButton ctx={ctx} refId={issue.ref} className="mr-2 text-muted-foreground" />
            <span className="font-medium">{issue.title}</span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            {issue.safetyCritical && (
              <>
                <span className="font-medium text-destructive">Safety-critical</span>
                <Sep />
              </>
            )}
            <span>{issue.category}</span>
            <Sep />
            <span>
              {issue.reportedBy}, {relativeDays(issue.reportedAt)}
            </span>
            {issue.photos > 0 && (
              <>
                <Sep />
                <span>{plural(issue.photos, "photo")}</span>
              </>
            )}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-7 sm:pl-0">
        {issue.workOrderRef ? (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => ctx.show({ kind: "work-order", ref: issue.workOrderRef ?? "" })}>
            {done ? "Fixed in" : "In"} {issue.workOrderRef}
            <ChevronRight aria-hidden />
          </Button>
        ) : done ? (
          <StatusBadge tone="neutral" className="rounded-md">
            {ISSUE_STATUS_LABELS[issue.status]}
          </StatusBadge>
        ) : ctx.can("create-work-order") ? (
          <ActionButton ctx={ctx} step={{ key: "create-work-order", label: "Create work order", ref: issue.ref }} />
        ) : (
          <StatusBadge tone="warning" className="rounded-md">
            No work order yet
          </StatusBadge>
        )}
      </div>
    </li>
  );
}

function CostCell({ wo }: { wo: WorkOrder }) {
  const over = wo.actualCostMinor !== null && wo.expectedCostMinor !== null && wo.actualCostMinor > wo.expectedCostMinor;
  return (
    <div className="text-right tabular-nums">
      <div className={cn(wo.actualCostMinor === null && "text-muted-foreground")}>{wo.actualCostMinor !== null ? formatXaf(wo.actualCostMinor) : "Not yet"}</div>
      <div className="text-xs text-muted-foreground">
        {wo.expectedCostMinor !== null ? `${formatXaf(wo.expectedCostMinor)} expected` : "No estimate"}
        {over && wo.expectedCostMinor !== null && wo.actualCostMinor !== null && (
          <span className="ml-1 font-medium text-amber-700 dark:text-amber-400">+{Math.round(((wo.actualCostMinor - wo.expectedCostMinor) / wo.expectedCostMinor) * 100)}%</span>
        )}
      </div>
    </div>
  );
}

function DueCell({ wo }: { wo: WorkOrder }) {
  if (wo.completedAt) return <span className="text-muted-foreground">Done {shortDay(wo.completedAt)}</span>;
  if (!wo.dueBy) return <span className="text-muted-foreground">No due date</span>;
  const overdue = daysFromToday(wo.dueBy) < 0;
  return (
    <div>
      <div>{shortDay(wo.dueBy)}</div>
      <div className={cn("text-xs", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>{dueLabel(wo.dueBy)}</div>
    </div>
  );
}

function WorkOrderList({ ctx, workOrders, muted = false }: { ctx: Ctx; workOrders: WorkOrder[]; muted?: boolean }) {
  const { ws } = ctx;
  return (
    <>
      <Card className="hidden gap-0 py-0 md:flex">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4 text-xs text-muted-foreground">Work order</TableHead>
              <TableHead className="text-xs text-muted-foreground">Status</TableHead>
              <TableHead className="text-xs text-muted-foreground">Assigned to</TableHead>
              <TableHead className="text-xs text-muted-foreground">Due</TableHead>
              <TableHead className="text-right text-xs text-muted-foreground">Actual cost</TableHead>
              <TableHead className="w-0 pr-4">
                <span className="sr-only">Next step</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workOrders.map((wo) => {
              const next = nextWoStep(ws, wo);
              return (
                <TableRow key={wo.id} className={cn("cursor-pointer", muted && "text-muted-foreground")} onClick={() => ctx.show({ kind: "work-order", ref: wo.ref })}>
                  <TableCell className="py-3 pl-4 whitespace-normal">
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span className="tabular-nums">{wo.ref}</span>
                      {wo.issueRef && (
                        <>
                          <Sep />
                          <span>from</span>
                          <RefButton ctx={ctx} refId={wo.issueRef} className="font-normal text-muted-foreground" />
                        </>
                      )}
                      {wo.safetyCritical && (
                        <>
                          <Sep />
                          <SafetyMark />
                        </>
                      )}
                    </div>
                    <div className={cn("mt-0.5 font-medium", muted ? "text-muted-foreground" : "text-foreground")}>{wo.title}</div>
                  </TableCell>
                  <TableCell>
                    <WoStatus status={wo.status} />
                  </TableCell>
                  <TableCell>{wo.assignee}</TableCell>
                  <TableCell>
                    <DueCell wo={wo} />
                  </TableCell>
                  <TableCell>
                    <CostCell wo={wo} />
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {next && <ActionButton ctx={ctx} step={next} />}
                      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Card className="gap-0 py-0 md:hidden">
        <ul className="divide-y">
          {workOrders.map((wo) => {
            const next = nextWoStep(ws, wo);
            return (
              <li key={wo.id}>
                <button type="button" className="w-full px-4 pt-3 pb-2 text-left active:bg-muted/50" onClick={() => ctx.show({ kind: "work-order", ref: wo.ref })}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span className="tabular-nums">{wo.ref}</span>
                        {wo.safetyCritical && <SafetyMark />}
                      </div>
                      <p className={cn("mt-0.5 font-medium leading-snug", muted && "text-muted-foreground")}>{wo.title}</p>
                    </div>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <WoStatus status={wo.status} />
                    <span>{wo.assignee}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {wo.dueBy && !wo.completedAt && (
                      <>
                        <span className={cn(daysFromToday(wo.dueBy) < 0 && "font-medium text-destructive")}>Due {shortDay(wo.dueBy)}, {dueLabel(wo.dueBy)}</span>
                        <Sep />
                      </>
                    )}
                    <span className="tabular-nums">
                      {wo.actualCostMinor !== null ? `${formatXaf(wo.actualCostMinor)} actual` : "No actual cost yet"}
                      {wo.expectedCostMinor !== null && ` · ${formatXaf(wo.expectedCostMinor)} expected`}
                    </span>
                  </div>
                </button>
                {next && ctx.can(next.key) && (
                  <div className="px-4 pb-3">
                    <ActionButton ctx={ctx} step={next} className="h-9 w-full" />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </>
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
      <SectionHeader
        title="Trips"
        count={<Count>{trips.length}</Count>}
        description={trips.length > 0 ? `Trips with this vehicle as primary vehicle · ${km(totalKm)} recorded` : "Trips with this vehicle as primary vehicle"}
        actions={<ActionButton ctx={ctx} step={{ key: "start-trip", label: "Start a trip", ref: null }} />}
      />
      {trips.length === 0 ? (
        <EmptyState icon={<Route className="size-6" />} message="No trips recorded for this vehicle yet." />
      ) : (
        <>
          <Card className="hidden gap-0 py-0 md:flex">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4 text-xs text-muted-foreground">Trip</TableHead>
                  <TableHead className="text-xs text-muted-foreground">Route</TableHead>
                  <TableHead className="text-xs text-muted-foreground">Dates</TableHead>
                  <TableHead className="text-xs text-muted-foreground">Driver</TableHead>
                  <TableHead className="text-right text-xs text-muted-foreground">Distance</TableHead>
                  <TableHead className="text-right text-xs text-muted-foreground">Revenue</TableHead>
                  <TableHead className="text-right text-xs text-muted-foreground">Costs</TableHead>
                  <TableHead className="pr-4 text-xs text-muted-foreground">Completeness</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trips.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer" onClick={() => ctx.show({ kind: "trip", number: t.number })}>
                    <TableCell className="py-3 pl-4">
                      <div className="font-medium tabular-nums">{t.number}</div>
                      <div className="text-xs text-muted-foreground">{t.type}</div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div>
                        {t.from} → {t.to}
                      </div>
                      {t.customer && <div className="text-xs text-muted-foreground">{t.customer}</div>}
                    </TableCell>
                    <TableCell>
                      <div>{shortDay(t.startedAt)}</div>
                      <div className="text-xs text-muted-foreground">{t.endedAt ? `to ${shortDay(t.endedAt)}` : "Still open"}</div>
                    </TableCell>
                    <TableCell>{t.driver}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.distanceKm !== null ? km(t.distanceKm) : <span className="text-muted-foreground">Not closed</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.revenueMinor !== null ? formatXaf(t.revenueMinor) : <span className="text-muted-foreground">None</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatXaf(t.costMinor)}</TableCell>
                    <TableCell className="pr-4">
                      <TripState trip={t} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Card className="gap-0 py-0 md:hidden">
            <ul className="divide-y">
              {trips.map((t) => (
                <li key={t.id}>
                  <button type="button" className="w-full px-4 py-3 text-left active:bg-muted/50" onClick={() => ctx.show({ kind: "trip", number: t.number })}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {t.from} → {t.to}
                        </p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {t.number} · {shortDay(t.startedAt)}
                          {t.endedAt ? `–${shortDay(t.endedAt)}` : ""} · {t.driver}
                        </p>
                      </div>
                      <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <TripState trip={t} />
                      {t.distanceKm !== null && <span className="tabular-nums">{km(t.distanceKm)}</span>}
                      <Sep />
                      <span className="tabular-nums">
                        {t.revenueMinor !== null ? `${formatXaf(t.revenueMinor)} revenue · ` : ""}
                        {formatXaf(t.costMinor)} costs
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </section>
  );
}

function TripState({ trip }: { trip: Trip }) {
  if (trip.status === "OPEN")
    return (
      <StatusBadge tone="info" icon={Route} className="rounded-md">
        Open
      </StatusBadge>
    );
  if (trip.exceptions > 0)
    return (
      <StatusBadge tone="warning" icon={TriangleAlert} className="rounded-md">
        {plural(trip.exceptions, "exception")}
      </StatusBadge>
    );
  return (
    <StatusBadge tone="success" className="rounded-md">
      Complete
    </StatusBadge>
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
    <div className="space-y-8">
      <section>
        <SectionHeader
          title={m.periodLabel}
          description="This vehicle's share of each entry. Awaiting review is never added to posted; posted is not paid."
          actions={
            <>
              <ActionButton ctx={ctx} step={{ key: "record-revenue", label: "Record revenue", ref: null }} variant="ghost" />
              <ActionButton ctx={ctx} step={{ key: "log-fuel", label: "Log fuel", ref: null }} />
              <ActionButton ctx={ctx} step={{ key: "record-expense", label: "Record expense", ref: null }} />
            </>
          }
        />
        <PeriodStats ctx={ctx} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="gap-0 py-0">
          <CardHead title="Spending by category" description={`Posted, ${m.periodLabel}`} />
          <CategoryBars ctx={ctx} />
        </Card>
        <Card className="gap-0 py-0">
          <CardHead title="Last 6 months" description="Posted entries by posting period" />
          <MonthlyBars ctx={ctx} />
        </Card>
      </div>

      <section>
        <SectionHeader title="Entries" count={<Count>{ws.entries.length}</Count>} description="Nothing is edited: a correction is a reversal, and both stay listed." />
        <div className="mb-3">
          <FilterChips options={ENTRY_FILTERS.map((f) => ({ key: f.key, label: f.label, count: ws.entries.filter(f.test).length }))} value={filter} onChange={setFilter} />
        </div>
        {shown.length === 0 ? (
          <EmptyState icon={<Receipt className="size-6" />} message="No entries match this filter." />
        ) : (
          <EntryList ctx={ctx} entries={shown} />
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

function CategoryBars({ ctx }: { ctx: Ctx }) {
  const cats = ctx.ws.money.byCategory;
  const total = cats.reduce((s, c) => s + c.minor, 0);
  const max = Math.max(1, ...cats.map((c) => c.minor));
  if (cats.length === 0) return <p className="px-4 py-6 text-sm text-muted-foreground">No posted expenses this period.</p>;
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

function EntryRowActions({ ctx, entry }: { ctx: Ctx; entry: MoneyEntry }) {
  const steps = entryActions(entry).filter((s) => ctx.can(s.key));
  const inline = steps.find((s) => s.key !== "reverse-entry");
  const menu = steps.filter((s) => s !== inline);
  return (
    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {inline && <ActionButton ctx={ctx} step={inline} size="xs" />}
      {menu.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`More actions for ${entry.number}`} />}>
            <Ellipsis aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {menu.map((s) => {
              const Icon = actionByKey(s.key).icon;
              return (
                <DropdownMenuItem key={s.key} onClick={() => ctx.act(s.key, s.ref)}>
                  <Icon className="text-muted-foreground" aria-hidden />
                  {s.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function EntryAmount({ entry }: { entry: MoneyEntry }) {
  const split = entry.amountMinor !== entry.entryTotalMinor;
  return (
    <div className="text-right tabular-nums">
      <div className={cn("font-medium", entry.status === "REVERSED" && "text-muted-foreground line-through")}>
        {formatXaf(entry.amountMinor, { signed: entry.direction === "REVENUE" })}
      </div>
      {split && <div className="text-xs text-muted-foreground">of {formatXaf(entry.entryTotalMinor)} entry</div>}
    </div>
  );
}

function EntryLink({ ctx, entry }: { ctx: Ctx; entry: MoneyEntry }) {
  if (!entry.link) return <span className="text-muted-foreground">None</span>;
  if (entry.link.kind === "TRIP") return <RefButton ctx={ctx} refId={entry.link.ref} hint="trip" className="font-normal" />;
  return <RefButton ctx={ctx} refId={entry.link.ref} className="font-normal" />;
}

function EntryList({ ctx, entries }: { ctx: Ctx; entries: MoneyEntry[] }) {
  return (
    <>
      <Card className="hidden gap-0 py-0 md:flex">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4 text-xs text-muted-foreground">Date</TableHead>
              <TableHead className="text-xs text-muted-foreground">Entry</TableHead>
              <TableHead className="text-xs text-muted-foreground">Linked to</TableHead>
              <TableHead className="text-xs text-muted-foreground">Status</TableHead>
              <TableHead className="text-xs text-muted-foreground">Evidence</TableHead>
              <TableHead className="text-right text-xs text-muted-foreground">This vehicle</TableHead>
              <TableHead className="w-0 pr-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id} className="cursor-pointer" onClick={() => ctx.show({ kind: "entry", number: e.number })}>
                <TableCell className="py-3 pl-4 text-muted-foreground">{shortDay(e.economicDate)}</TableCell>
                <TableCell className="whitespace-normal">
                  <div className="font-medium">
                    {e.category}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{LAYER_LABELS[e.layer]}</span>
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {e.number}
                    {e.counterparty ? ` · ${e.counterparty}` : ""}
                  </div>
                </TableCell>
                <TableCell>
                  <EntryLink ctx={ctx} entry={e} />
                </TableCell>
                <TableCell>
                  <EntryStatusBadge status={e.status} />
                </TableCell>
                <TableCell>
                  <Evidence state={e.evidence} />
                </TableCell>
                <TableCell>
                  <EntryAmount entry={e} />
                </TableCell>
                <TableCell className="pr-4">
                  <EntryRowActions ctx={ctx} entry={e} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Card className="gap-0 py-0 md:hidden">
        <ul className="divide-y">
          {entries.map((e) => (
            <li key={e.id} className="px-4 py-3">
              <button type="button" className="w-full text-left" onClick={() => ctx.show({ kind: "entry", number: e.number })}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {e.category}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">{LAYER_LABELS[e.layer]}</span>
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {shortDay(e.economicDate)} · {e.number}
                    </p>
                  </div>
                  <EntryAmount entry={e} />
                </div>
              </button>
              <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs">
                <EntryStatusBadge status={e.status} />
                <Evidence state={e.evidence} />
                {e.link && (
                  <span className="text-muted-foreground">
                    for <EntryLink ctx={ctx} entry={e} />
                  </span>
                )}
                <span className="ml-auto">
                  <EntryRowActions ctx={ctx} entry={e} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Documents

function DocumentsTab({ ctx }: { ctx: Ctx }) {
  const docs = ctx.ws.documents;
  return (
    <section>
      <SectionHeader
        title="Documents"
        count={<Count>{docs.length}</Count>}
        description="Expiry dates drive reminders. A renewal keeps every earlier version."
        actions={<ActionButton ctx={ctx} step={{ key: "add-document", label: "Add document", ref: null }} />}
      />
      {docs.length === 0 ? (
        <EmptyState icon={<FileText className="size-6" />} message="No documents recorded for this vehicle." />
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-lg",
                      d.state === "EXPIRED" ? "bg-destructive/10 text-destructive" : d.state === "EXPIRING" ? "bg-warning/15 text-warning-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <FileText className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => ctx.show({ kind: "document", id: d.id })}
                      className="rounded-sm text-left font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {d.type}
                    </button>
                    <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      {d.number ?? "No number"}
                      {d.issuedAt && ` · issued ${formatDate(d.issuedAt)}`}
                      {d.expiresAt && ` · expires ${formatDate(d.expiresAt)}`}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                      <span>{d.previousVersions > 0 ? `${plural(d.previousVersions, "earlier version")} kept` : "First version"}</span>
                      <Sep />
                      {d.hasFile ? (
                        <span className="inline-flex items-center gap-1">
                          <Paperclip className="size-3" aria-hidden />
                          Scan on file
                        </span>
                      ) : (
                        <span className="font-medium text-amber-700 dark:text-amber-400">No scan on file</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-12 sm:pl-0">
                  <DocState doc={d} />
                  {d.expiresAt && (
                    <ActionButton ctx={ctx} step={{ key: "renew-document", label: "Renew", ref: d.id }} variant={d.state === "EXPIRED" ? "default" : "outline"} />
                  )}
                </div>
              </li>
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
      <SectionHeader
        title="History"
        description="Everything recorded on this vehicle. Nothing is edited away: corrections appear as reversals next to the original."
        actions={<ActionButton ctx={ctx} step={{ key: "add-note", label: "Add note", ref: null }} />}
      />
      <FilterChips options={options} value={filter} onChange={setFilter} />
      {groups.length === 0 ? (
        <EmptyState icon={<Clock className="size-6" />} message="No events of this kind yet." />
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
                    <EventRow key={e.id} ctx={ctx} event={e} timeMode="time" />
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

// ---------------------------------------------------------------------------
// Detail sheet: one record at a time, with a back stack so refs can be followed

function DetailSheet({
  ctx,
  stack,
  onBack,
  onClose,
  ticks,
  onTick,
}: {
  ctx: Ctx;
  stack: Detail[];
  onBack: () => void;
  onClose: () => void;
  ticks: Record<string, boolean[]>;
  onTick: (ref: string, index: number, done: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const current = stack.length > 0 ? stack[stack.length - 1] : undefined;
  const previous = stack.length > 1 ? stack[stack.length - 2] : undefined;
  return (
    <Sheet open={current !== undefined} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn("gap-0 overflow-y-auto", isMobile ? "max-h-[92vh] rounded-t-xl" : "data-[side=right]:sm:max-w-lg")}
      >
        {previous && (
          <button type="button" onClick={onBack} className="flex items-center gap-1 self-start px-4 pt-3 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden />
            Back to {detailLabel(ctx.ws, previous)}
          </button>
        )}
        {current && <DetailBody ctx={ctx} detail={current} ticks={ticks} onTick={onTick} />}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({ ctx, detail, ticks, onTick }: { ctx: Ctx; detail: Detail; ticks: Record<string, boolean[]>; onTick: (ref: string, index: number, done: boolean) => void }) {
  const { ws } = ctx;
  switch (detail.kind) {
    case "work-order": {
      const wo = ws.workOrders.find((w) => w.ref === detail.ref);
      return wo ? <WorkOrderDetail ctx={ctx} wo={wo} ticks={ticks[wo.ref]} onTick={onTick} /> : <Missing />;
    }
    case "issue": {
      const issue = ws.issues.find((i) => i.ref === detail.ref);
      return issue ? <IssueDetail ctx={ctx} issue={issue} /> : <Missing />;
    }
    case "entry": {
      const entry = ws.entries.find((e) => e.number === detail.number);
      return entry ? <EntryDetail ctx={ctx} entry={entry} /> : <Missing />;
    }
    case "trip": {
      const trip = ws.trips.find((t) => t.number === detail.number);
      return trip ? <TripDetail ctx={ctx} trip={trip} /> : <Missing />;
    }
    case "document": {
      const doc = ws.documents.find((d) => d.id === detail.id);
      return doc ? <DocumentDetail ctx={ctx} doc={doc} /> : <Missing />;
    }
    case "readings":
      return <ReadingsDetail ctx={ctx} />;
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
      {meta && <div className="mt-2.5 flex flex-wrap items-center gap-2">{meta}</div>}
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

function SheetActions({ ctx, steps }: { ctx: Ctx; steps: Step[] }) {
  const allowed = steps.filter((s) => ctx.can(s.key));
  if (allowed.length === 0) return null;
  return (
    <SheetFooter className="sticky bottom-0 flex-row flex-wrap border-t bg-popover">
      {allowed.map((s, i) => (
        <ActionButton
          key={s.key}
          ctx={ctx}
          step={s}
          size="default"
          variant={i === 0 ? "default" : "outline"}
          className={cn("h-10 sm:h-8", i === 0 ? "basis-full sm:basis-auto" : "flex-1 sm:flex-none")}
        />
      ))}
    </SheetFooter>
  );
}

function WorkOrderDetail({ ctx, wo, ticks, onTick }: { ctx: Ctx; wo: WorkOrder; ticks: boolean[] | undefined; onTick: (ref: string, index: number, done: boolean) => void }) {
  const { ws } = ctx;
  const issue = wo.issueRef ? ws.issues.find((i) => i.ref === wo.issueRef) : undefined;
  const grounding = ws.readiness.state === "GROUNDED" && ws.readiness.workOrderRef === wo.ref;
  const checklist = wo.checklist.map((c, i) => ({ ...c, done: ticks?.[i] ?? c.done }));
  const doneCount = checklist.filter((c) => c.done).length;
  const canTick = wo.status === "OPEN" && ctx.can("complete-work-order");
  const recorded = wo.costLines.reduce((s, c) => s + c.amountMinor, 0);
  const entryNumbers = wo.costLines.map((c) => c.entryNumber).filter((n): n is string => n !== null);
  const chronology = ws.timeline.filter((e) => e.ref !== null && (e.ref === wo.ref || e.ref === wo.issueRef || entryNumbers.includes(e.ref)));
  const acceptsCosts = wo.status === "OPEN" || wo.status === "PENDING_CLOSE";

  const steps: Step[] = [];
  const next = nextWoStep(ws, wo);
  if (next) steps.push(next);
  if (acceptsCosts) steps.push({ key: "record-expense", label: "Add a cost", ref: wo.ref });
  if (wo.status === "SUBMITTED" || wo.status === "OPEN") steps.push({ key: "cancel-work-order", label: "Cancel", ref: wo.ref });

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
        {grounding && (
          <p className="flex gap-2 rounded-lg bg-destructive/5 px-3 py-2.5 text-sm text-destructive dark:bg-destructive/10">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            This work order keeps the vehicle grounded. After sign-off, a manager releases it to service.
          </p>
        )}

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
                        <Checkbox checked={c.done} onCheckedChange={(checked) => onTick(wo.ref, i, checked)} className="mt-0.5" />
                        <span className={cn(c.done && "text-muted-foreground")}>{c.label}</span>
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
            </>
          )}
        </DetailSection>

        <DetailSection title="Costs" aside={wo.costLines.length > 0 ? `${formatXaf(recorded)} so far` : undefined}>
          {wo.costLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No costs recorded against this work order.</p>
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
                        <span>Not recorded as an expense yet</span>
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
      <SheetActions ctx={ctx} steps={steps} />
    </>
  );
}

function IssueDetail({ ctx, issue }: { ctx: Ctx; issue: Issue }) {
  const events = ctx.ws.timeline.filter((e) => e.ref === issue.ref);
  return (
    <>
      <DetailHeader
        eyebrow={`Problem ${issue.ref}`}
        title={issue.title}
        meta={
          <>
            <StatusBadge tone={issue.status === "OPEN" ? "warning" : issue.status === "IN_WORK" ? "info" : "neutral"} className="rounded-md">
              {ISSUE_STATUS_LABELS[issue.status]}
            </StatusBadge>
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
        {issue.safetyCritical && (
          <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">
            Safety-critical reports ground the vehicle when they are recorded. Only a manager can release it, after a closed work order.
          </p>
        )}
        <DetailSection title="Chronology">
          <Chronology ctx={ctx} events={events} currentRef={issue.ref} />
        </DetailSection>
      </div>
      <SheetActions ctx={ctx} steps={!issue.workOrderRef && issue.status === "OPEN" ? [{ key: "create-work-order", label: "Create work order", ref: issue.ref }] : []} />
    </>
  );
}

function EntryDetail({ ctx, entry }: { ctx: Ctx; entry: MoneyEntry }) {
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
            ["Economic date", formatDate(entry.economicDate)],
            ["Layer", LAYER_LABELS[entry.layer]],
            ["This vehicle", formatXaf(entry.amountMinor)],
            ["Whole entry", split ? `${formatXaf(entry.entryTotalMinor)}, split across vehicles` : "Same: not split"],
            ["Counterparty", entry.counterparty ?? "Not recorded"],
            ["Recorded by", entry.recordedBy],
            ["Linked to", <EntryLink ctx={ctx} entry={entry} />],
            ["Receipt", entry.evidence === "ATTACHED" ? "Attached · verification not recorded" : "Not supplied"],
          ]}
        />
        <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">
          {entry.status === "SUBMITTED"
            ? "Awaiting review: not counted in posted totals until approved. The person who recorded it cannot approve it."
            : "Posted means recorded in the books, not paid. A mistake is corrected by a reversal; the original stays."}
        </p>
        <DetailSection title="Chronology">
          <Chronology ctx={ctx} events={events} currentRef={entry.number} />
        </DetailSection>
      </div>
      <SheetActions ctx={ctx} steps={entryActions(entry)} />
    </>
  );
}

function TripDetail({ ctx, trip }: { ctx: Ctx; trip: Trip }) {
  const { ws } = ctx;
  const linked = ws.entries.filter((e) => e.link?.kind === "TRIP" && e.link.ref === trip.number);
  const readings = ws.readings.filter(
    (r) => (r.source === "Trip start" || r.source === "Trip end") && r.observedAt >= trip.startedAt && (trip.endedAt === null || r.observedAt <= trip.endedAt),
  );
  const events = ws.timeline.filter((e) => e.kind === "TRIP" && e.ref === trip.number);
  const open = trip.status === "OPEN";
  return (
    <>
      <DetailHeader
        eyebrow={`Trip ${trip.number} · ${trip.type}`}
        title={`${trip.from} → ${trip.to}`}
        meta={<TripState trip={trip} />}
      />
      <div className="space-y-6 p-4">
        <FactList
          rows={[
            ["Customer", trip.customer ?? "None"],
            ["Driver", trip.driver],
            ["Started", formatDateTime(trip.startedAt)],
            ["Ended", trip.endedAt ? formatDateTime(trip.endedAt) : "Still open"],
            ["Distance", trip.distanceKm !== null ? km(trip.distanceKm) : "Known when closed"],
            ["Revenue", trip.revenueMinor !== null ? formatXaf(trip.revenueMinor) : "None recorded"],
            ["Costs", formatXaf(trip.costMinor)],
          ]}
        />
        <DetailSection title="Linked money" aside={linked.length > 0 ? plural(linked.length, "entry", "entries") : undefined}>
          {linked.length === 0 ? (
            <p className="text-sm text-muted-foreground">No entries linked to this trip.</p>
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
      <SheetActions
        ctx={ctx}
        steps={[
          ...(open ? [{ key: "log-fuel" as const, label: "Log fuel", ref: trip.number }] : []),
          { key: "record-expense", label: "Add a cost", ref: trip.number },
        ]}
      />
    </>
  );
}

function DocumentDetail({ ctx, doc }: { ctx: Ctx; doc: VehicleDocument }) {
  const events = ctx.ws.timeline.filter((e) => e.ref === doc.id);
  return (
    <>
      <DetailHeader eyebrow="Document" title={doc.type} meta={<DocState doc={doc} />} />
      <div className="space-y-6 p-4">
        <FactList
          rows={[
            ["Number", doc.number ?? "Not recorded"],
            ["Issued", doc.issuedAt ? formatDate(doc.issuedAt) : "Not recorded"],
            ["Expires", doc.expiresAt ? formatDate(doc.expiresAt) : "No expiry date"],
            ["Scan", doc.hasFile ? "On file" : "Not supplied"],
            ["Earlier versions", doc.previousVersions > 0 ? `${doc.previousVersions}, kept unchanged` : "None"],
          ]}
        />
        <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">
          Renewing creates a new version and keeps this one. A renewal fee is recorded once, as an expense linked to the document.
        </p>
        <DetailSection title="Chronology">
          <Chronology ctx={ctx} events={events} currentRef={doc.id} />
        </DetailSection>
      </div>
      <SheetActions ctx={ctx} steps={doc.expiresAt ? [{ key: "renew-document", label: "Renew", ref: doc.id }] : []} />
    </>
  );
}

function ReadingsDetail({ ctx }: { ctx: Ctx }) {
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
                {delta !== null && <span className={cn("shrink-0 text-xs tabular-nums", delta < 0 ? "font-medium text-destructive" : "text-muted-foreground")}>{delta >= 0 ? `+${km(delta)}` : `−${km(-delta)}`}</span>}
              </li>
            );
          })}
        </ol>
      </div>
      <SheetActions ctx={ctx} steps={[{ key: "record-reading", label: "Record odometer", ref: null }]} />
    </>
  );
}

