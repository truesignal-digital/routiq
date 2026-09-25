// PROTOTYPE — throwaway, issue #44. Variant B, "Vehicle story": the vehicle's
// history is the page. A composer adds to it, open threads are pinned above
// it, and a sticky vehicle card carries identity, readiness and money.

import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  BadgeCheck,
  Banknote,
  Building2,
  ChevronDown,
  CircleCheck,
  Clock,
  Ellipsis,
  Eye,
  FilePlus2,
  FileText,
  Flag,
  Gauge,
  Link2,
  MapPin,
  OctagonAlert,
  Paperclip,
  Receipt,
  Route,
  Search,
  ShieldCheck,
  StickyNote,
  TriangleAlert,
  Undo2,
  UserRound,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { actionByKey, useVehicleActions, type ActionGroup, type ActionKey, type VehicleAction } from "./actions.js";
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
  type Issue,
  type MoneyEntry,
  type ProtoRole,
  type TimelineEvent,
  type TimelineKind,
  type Trip,
  type VehicleDocument,
  type VehicleIdentity,
  type VehicleWorkspace,
  type WorkOrder,
} from "./mockData.js";

type Actions = ReturnType<typeof useVehicleActions>;
type Tone = "neutral" | "critical" | "warning" | "success" | "info";
type RefPrefer = "TRIP" | "ENTRY";

const TONE_TAG: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  critical: "bg-red-500/10 text-red-700 dark:text-red-300",
  warning: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  success: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  info: "bg-sky-500/10 text-sky-800 dark:text-sky-300",
};

const TONE_ICON: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground ring-foreground/10",
  critical: "bg-red-500/10 text-red-700 ring-red-500/30 dark:text-red-300",
  warning: "bg-amber-500/15 text-amber-800 ring-amber-500/30 dark:text-amber-300",
  success: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300",
  info: "bg-sky-500/10 text-sky-700 ring-sky-500/30 dark:text-sky-300",
};

const TONE_RANK: Record<Tone, number> = { critical: 0, warning: 1, info: 2, neutral: 3, success: 4 };

const KIND_META: Record<TimelineKind, { icon: LucideIcon; label: string }> = {
  ISSUE: { icon: TriangleAlert, label: "Problem" },
  GROUNDED: { icon: OctagonAlert, label: "Grounded" },
  WORK_ORDER: { icon: Wrench, label: "Work order" },
  RELEASED: { icon: ShieldCheck, label: "Released" },
  EXPENSE: { icon: Receipt, label: "Expense" },
  REVENUE: { icon: Banknote, label: "Revenue" },
  APPROVAL: { icon: BadgeCheck, label: "Approval" },
  REVERSAL: { icon: Undo2, label: "Reversal" },
  TRIP: { icon: Route, label: "Trip" },
  READING: { icon: Gauge, label: "Reading" },
  DOCUMENT: { icon: FileText, label: "Document" },
  ASSIGNMENT: { icon: UserRound, label: "Custody" },
  LIFECYCLE: { icon: Flag, label: "Lifecycle" },
  NOTE: { icon: StickyNote, label: "Note" },
};

type FilterId = "all" | "maintenance" | "money" | "trips" | "documents" | "readings" | "people" | "lifecycle";
const FILTERS: ReadonlyArray<{ id: FilterId; label: string; kinds: readonly TimelineKind[] | null }> = [
  { id: "all", label: "All", kinds: null },
  { id: "maintenance", label: "Maintenance", kinds: ["ISSUE", "GROUNDED", "WORK_ORDER", "RELEASED"] },
  { id: "money", label: "Money", kinds: ["EXPENSE", "REVENUE", "APPROVAL", "REVERSAL"] },
  { id: "trips", label: "Trips", kinds: ["TRIP"] },
  { id: "documents", label: "Documents", kinds: ["DOCUMENT"] },
  { id: "readings", label: "Readings", kinds: ["READING"] },
  { id: "people", label: "People", kinds: ["ASSIGNMENT", "NOTE"] },
  { id: "lifecycle", label: "Lifecycle", kinds: ["LIFECYCLE"] },
];

const LIFECYCLE_LABELS: Record<VehicleIdentity["lifecycle"], string> = {
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

/** Frequent actions first; the rest live in "More". Order is per role. */
const COMPOSER_KEYS: Record<ProtoRole, readonly ActionKey[]> = {
  ADMIN: ["report-issue", "log-fuel", "record-reading", "record-expense", "create-work-order"],
  OPS_MANAGER: ["report-issue", "log-fuel", "record-reading", "record-expense", "create-work-order"],
  MAINTENANCE: ["report-issue", "create-work-order", "complete-work-order", "schedule-service"],
  FIELD_SUBMITTER: ["log-fuel", "record-reading", "report-issue", "record-expense", "attach-receipt"],
  FINANCE_APPROVER: ["review-entry", "record-expense", "log-fuel", "record-revenue", "add-note"],
  EXECUTIVE_VIEWER: [],
};

/** Whose next steps come first in the open threads: the role's own kind of work. */
const ROLE_FOCUS: Partial<Record<ProtoRole, ActionGroup>> = {
  MAINTENANCE: "Maintenance",
  FIELD_SUBMITTER: "Capture",
  FINANCE_APPROVER: "Money",
};

const COMPOSER_LABELS: Partial<Record<ActionKey, string>> = {
  "complete-work-order": "Complete work",
  "review-entry": "Review entry",
  "attach-receipt": "Receipt",
  "schedule-service": "Schedule service",
};

// ---------------------------------------------------------------- derivations

interface Step {
  key: ActionKey;
  label: string;
  ref: string | null;
}

type RefTarget =
  | { kind: "WORK_ORDER"; wo: WorkOrder }
  | { kind: "ISSUE"; issue: Issue }
  | { kind: "ENTRY"; entry: MoneyEntry }
  | { kind: "TRIP"; trip: Trip }
  | { kind: "DOCUMENT"; doc: VehicleDocument };

interface StoryIndex {
  threadOf: Map<string, string>;
  threadSize: Map<string, number>;
  tokenRe: RegExp | null;
}

function shortDocType(type: string): string {
  return type.replace(/\s*\(.*\)\s*$/, "");
}

function shortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  const sameYear = iso.slice(0, 4) === TODAY.slice(0, 4);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function localDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T12:00:00`) - Date.parse(`${fromKey}T12:00:00`)) / 86_400_000);
}

function dayHeading(key: string): { primary: string; secondary: string } {
  const d = new Date(`${key}T12:00:00`);
  const sameYear = key.slice(0, 4) === TODAY.slice(0, 4);
  const long = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  const ago = daysBetween(key, TODAY);
  if (ago === 0) return { primary: "Today", secondary: long };
  if (ago === 1) return { primary: "Yesterday", secondary: long };
  return { primary: long, secondary: ago < 60 ? `${ago} days ago` : "" };
}

function dueText(dueBy: string): string {
  const days = daysBetween(TODAY, dueBy.slice(0, 10));
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days > 1) return `due in ${days} days`;
  return days === -1 ? "overdue since yesterday" : `${-days} days overdue`;
}

function monthYear(key: string): string {
  return new Date(`${key}T12:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function resolveRef(ws: VehicleWorkspace, token: string, prefer: RefPrefer): RefTarget | null {
  const wo = ws.workOrders.find((w) => w.ref === token);
  if (wo) return { kind: "WORK_ORDER", wo };
  const issue = ws.issues.find((i) => i.ref === token);
  if (issue) return { kind: "ISSUE", issue };
  const trip = ws.trips.find((t) => t.number === token);
  const entry = ws.entries.find((e) => e.number === token);
  if (trip && entry) return prefer === "TRIP" ? { kind: "TRIP", trip } : { kind: "ENTRY", entry };
  if (trip) return { kind: "TRIP", trip };
  if (entry) return { kind: "ENTRY", entry };
  const doc = ws.documents.find((d) => d.number === token || d.id === token);
  if (doc) return { kind: "DOCUMENT", doc };
  return null;
}

function threadKeyForTarget(t: RefTarget): string | null {
  switch (t.kind) {
    case "WORK_ORDER":
      return t.wo.ref;
    case "ISSUE":
      return t.issue.workOrderRef ?? t.issue.ref;
    case "ENTRY":
      return t.entry.link?.ref ?? null;
    case "TRIP":
      return t.trip.number;
    case "DOCUMENT":
      return t.doc.id;
  }
}

/** Which story thread an event belongs to: issue → work order → costs, trip → fuel/readings. */
function threadKeyForEvent(ws: VehicleWorkspace, ev: TimelineEvent): string | null {
  switch (ev.kind) {
    case "WORK_ORDER":
    case "RELEASED":
    case "TRIP":
    case "DOCUMENT":
      return ev.ref;
    case "ISSUE":
    case "GROUNDED": {
      const issue = ws.issues.find((i) => i.ref === ev.ref);
      return issue?.workOrderRef ?? ev.ref;
    }
    case "EXPENSE":
    case "REVENUE":
    case "APPROVAL":
    case "REVERSAL":
      return ws.entries.find((e) => e.number === ev.ref)?.link?.ref ?? null;
    case "READING": {
      const reading = ws.readings.find((r) => r.observedAt === ev.at);
      if (!reading) return null;
      const wo = ws.workOrders.find((w) => reading.note?.includes(w.ref));
      if (wo) return wo.ref;
      if (reading.source === "Trip start") return ws.trips.find((t) => t.startedAt === reading.observedAt)?.number ?? null;
      if (reading.source === "Trip end") return ws.trips.find((t) => t.endedAt === reading.observedAt)?.number ?? null;
      return null;
    }
    default:
      return null;
  }
}

function threadLabel(ws: VehicleWorkspace, key: string): string {
  if (ws.trips.some((t) => t.number === key)) return `trip ${key}`;
  const doc = ws.documents.find((d) => d.id === key);
  if (doc) return shortDocType(doc.type);
  return key;
}

function threadTitle(ws: VehicleWorkspace, key: string): string {
  const wo = ws.workOrders.find((w) => w.ref === key);
  if (wo) return `${wo.title} · ${WORK_ORDER_STATUS_LABELS[wo.status]}`;
  const issue = ws.issues.find((i) => i.ref === key);
  if (issue) return `${issue.title} · ${ISSUE_STATUS_LABELS[issue.status]}`;
  const trip = ws.trips.find((t) => t.number === key);
  if (trip) return `${trip.from} → ${trip.to} · ${trip.status === "OPEN" ? "Open" : "Closed"}`;
  const doc = ws.documents.find((d) => d.id === key);
  if (doc) return doc.number ?? doc.type;
  return "";
}

function buildIndex(ws: VehicleWorkspace): StoryIndex {
  const threadOf = new Map<string, string>();
  const threadSize = new Map<string, number>();
  for (const ev of ws.timeline) {
    const key = threadKeyForEvent(ws, ev);
    if (!key) continue;
    threadOf.set(ev.id, key);
    threadSize.set(key, (threadSize.get(key) ?? 0) + 1);
  }
  const tokens = [
    ...ws.workOrders.map((w) => w.ref),
    ...ws.issues.map((i) => i.ref),
    ...ws.entries.map((e) => e.number),
    ...ws.trips.map((t) => t.number),
    ...ws.documents.flatMap((d) => (d.number && d.number !== ws.vehicle.plate ? [d.number] : [])),
  ];
  const unique = [...new Set(tokens)].sort((a, b) => b.length - a.length);
  const escaped = unique.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const tokenRe = escaped.length > 0 ? new RegExp(`(?<![\\w-])(${escaped.join("|")})(?![\\w])`, "g") : null;
  return { threadOf, threadSize, tokenRe };
}

function workOrderSteps(wo: WorkOrder, can: Actions["can"]): Step[] {
  const steps: Step[] = [];
  if (wo.status === "OPEN") {
    if (can("complete-work-order")) steps.push({ key: "complete-work-order", label: "Complete", ref: wo.ref });
    if (can("record-expense")) steps.push({ key: "record-expense", label: "Add cost", ref: `${wo.ref} · ${wo.title}` });
  }
  if (wo.status === "PENDING_CLOSE" && can("approve-closure")) steps.push({ key: "approve-closure", label: "Sign off", ref: wo.ref });
  if (wo.status === "SUBMITTED" && can("approve-work-order")) steps.push({ key: "approve-work-order", label: "Authorize", ref: wo.ref });
  return steps;
}

function issueSteps(issue: Issue, can: Actions["can"]): Step[] {
  if (issue.status === "OPEN" && !issue.workOrderRef && can("create-work-order")) {
    return [{ key: "create-work-order", label: "Create work order", ref: `${issue.ref} · ${issue.title}` }];
  }
  return [];
}

function entrySteps(entry: MoneyEntry, can: Actions["can"]): Step[] {
  const steps: Step[] = [];
  if (entry.status === "SUBMITTED" && can("review-entry")) steps.push({ key: "review-entry", label: "Review", ref: entry.number });
  const live = entry.status === "POSTED" || entry.status === "SUBMITTED";
  if (live && entry.evidence === "MISSING" && can("attach-receipt")) steps.push({ key: "attach-receipt", label: "Attach receipt", ref: entry.number });
  return steps;
}

function documentSteps(doc: VehicleDocument, can: Actions["can"]): Step[] {
  if ((doc.state === "EXPIRED" || doc.state === "EXPIRING") && can("renew-document")) return [{ key: "renew-document", label: "Renew", ref: doc.id }];
  return [];
}

function eventSteps(ws: VehicleWorkspace, ev: TimelineEvent, can: Actions["can"]): Step[] {
  switch (ev.kind) {
    case "ISSUE": {
      const issue = ws.issues.find((i) => i.ref === ev.ref);
      return issue ? issueSteps(issue, can) : [];
    }
    case "WORK_ORDER": {
      const wo = ws.workOrders.find((w) => w.ref === ev.ref);
      return wo ? workOrderSteps(wo, can) : [];
    }
    case "EXPENSE":
    case "REVENUE": {
      const entry = ws.entries.find((e) => e.number === ev.ref);
      return entry ? entrySteps(entry, can) : [];
    }
    case "DOCUMENT": {
      const doc = ws.documents.find((d) => d.id === ev.ref);
      return doc ? documentSteps(doc, can) : [];
    }
    default:
      return [];
  }
}

/** A sensible record for actions opened from a menu rather than from a record. */
function defaultRef(ws: VehicleWorkspace, key: ActionKey): string | null {
  switch (key) {
    case "complete-work-order":
    case "cancel-work-order":
      return ws.workOrders.find((w) => w.status === "OPEN")?.ref ?? null;
    case "approve-closure":
      return ws.workOrders.find((w) => w.status === "PENDING_CLOSE")?.ref ?? null;
    case "approve-work-order":
      return ws.workOrders.find((w) => w.status === "SUBMITTED")?.ref ?? null;
    case "review-entry":
      return ws.entries.find((e) => e.status === "SUBMITTED")?.number ?? null;
    case "attach-receipt":
      return ws.entries.find((e) => e.evidence === "MISSING" && (e.status === "POSTED" || e.status === "SUBMITTED"))?.number ?? null;
    case "renew-document":
      return (ws.documents.find((d) => d.state === "EXPIRED") ?? ws.documents.find((d) => d.state === "EXPIRING"))?.id ?? null;
    default:
      return null;
  }
}

interface OpenThread {
  id: string;
  tone: Tone;
  icon: LucideIcon;
  token: string;
  prefer: RefPrefer;
  title: string;
  state: string;
  stateTone: Tone;
  meta: string;
  waitingOn: string;
  steps: Step[];
  threadKey: string | null;
}

function buildOpenThreads(ws: VehicleWorkspace, can: Actions["can"]): OpenThread[] {
  const out: OpenThread[] = [];
  const groundingWo = ws.readiness.state === "GROUNDED" ? ws.readiness.workOrderRef : null;
  for (const wo of ws.workOrders) {
    const base = { id: wo.id, icon: Wrench, token: wo.ref, prefer: "ENTRY" as const, title: wo.title, steps: workOrderSteps(wo, can), threadKey: wo.ref };
    if (wo.status === "OPEN") {
      const done = wo.checklist.filter((c) => c.done).length;
      const grounding = wo.ref === groundingWo;
      out.push({
        ...base,
        tone: grounding ? "critical" : "neutral",
        state: "In progress",
        stateTone: "info",
        meta: [
          wo.checklist.length > 0 ? `${done} of ${wo.checklist.length} steps done` : null,
          wo.dueBy ? dueText(wo.dueBy) : null,
          `with ${wo.assignee}`,
          grounding ? "keeps the vehicle grounded" : null,
        ]
          .filter(Boolean)
          .join(" · "),
        waitingOn: wo.assignee,
      });
    } else if (wo.status === "PENDING_CLOSE") {
      out.push({
        ...base,
        tone: "warning",
        state: "Awaiting sign-off",
        stateTone: "warning",
        meta: `Completed by ${wo.completedBy ?? "the workshop"} · ${formatXaf(wo.actualCostMinor ?? 0)} actual vs ${formatXaf(wo.expectedCostMinor ?? 0)} expected`,
        waitingOn: "a finance approver",
      });
    } else if (wo.status === "SUBMITTED") {
      out.push({ ...base, tone: "warning", state: "Awaiting authorization", stateTone: "warning", meta: `Expected ${formatXaf(wo.expectedCostMinor ?? 0)}`, waitingOn: "a finance approver" });
    }
  }
  for (const issue of ws.issues) {
    if (issue.status !== "OPEN" || issue.workOrderRef) continue;
    out.push({
      id: issue.id,
      tone: issue.safetyCritical ? "critical" : "neutral",
      icon: TriangleAlert,
      token: issue.ref,
      prefer: "ENTRY",
      title: issue.title,
      state: "No work order yet",
      stateTone: "neutral",
      meta: `Reported by ${issue.reportedBy}, ${relativeDays(issue.reportedAt)}${issue.safetyCritical ? " · safety-critical" : ""}`,
      waitingOn: "the workshop",
      steps: issueSteps(issue, can),
      threadKey: issue.ref,
    });
  }
  for (const doc of ws.documents) {
    if (doc.state !== "EXPIRED" && doc.state !== "EXPIRING") continue;
    const expired = doc.state === "EXPIRED";
    out.push({
      id: doc.id,
      tone: expired ? "critical" : "warning",
      icon: FileText,
      token: doc.number ?? doc.id,
      prefer: "ENTRY",
      title: shortDocType(doc.type),
      state: expired ? "Expired" : `Expires in ${doc.daysLeft ?? "?"} days`,
      stateTone: expired ? "critical" : "warning",
      meta: expired
        ? `Expired ${doc.expiresAt ? shortDate(doc.expiresAt) : ""} · the vehicle cannot legally run until it is renewed`
        : `Valid until ${doc.expiresAt ? formatDate(doc.expiresAt) : "unknown"}`,
      waitingOn: "operations",
      steps: documentSteps(doc, can),
      threadKey: doc.id,
    });
  }
  for (const entry of ws.entries) {
    if (entry.status === "SUBMITTED") {
      out.push({
        id: `${entry.id}-review`,
        tone: "warning",
        icon: Receipt,
        token: entry.number,
        prefer: "ENTRY",
        title: `${entry.category}${entry.counterparty ? ` · ${entry.counterparty}` : ""}`,
        state: "Awaiting review",
        stateTone: "warning",
        meta: `${formatXaf(entry.amountMinor)} recorded by ${entry.recordedBy} · not counted as posted${entry.link ? ` · part of ${entry.link.ref}` : ""}`,
        waitingOn: "a finance approver",
        steps: entrySteps(entry, can).filter((s) => s.key === "review-entry"),
        threadKey: entry.link?.ref ?? null,
      });
    }
    if (entry.evidence === "MISSING" && (entry.status === "POSTED" || entry.status === "SUBMITTED")) {
      out.push({
        id: `${entry.id}-receipt`,
        tone: "warning",
        icon: Paperclip,
        token: entry.number,
        prefer: "ENTRY",
        title: `${entry.category}${entry.counterparty ? ` · ${entry.counterparty}` : ""}`,
        state: "Receipt missing",
        stateTone: "warning",
        meta: `${formatXaf(entry.amountMinor)} ${ENTRY_STATUS_LABELS[entry.status].toLowerCase()} without proof · recorded by ${entry.recordedBy}`,
        waitingOn: `${entry.recordedBy}, who recorded it`,
        steps: entrySteps(entry, can).filter((s) => s.key === "attach-receipt"),
        threadKey: entry.link?.ref ?? null,
      });
    }
  }
  return out.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
}

// -------------------------------------------------------------------- context

interface StoryCtx {
  ws: VehicleWorkspace;
  actions: Actions;
  index: StoryIndex;
  readOnly: boolean;
  activeThread: string | null;
  hoverThread: string | null;
  setHoverThread: (key: string | null) => void;
  showThread: (key: string) => void;
}

const Ctx = createContext<StoryCtx | null>(null);

function useStory(): StoryCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("VariantB: story context missing");
  return ctx;
}

// ------------------------------------------------------------------ the page

export function VariantB({ ws }: { ws: VehicleWorkspace }) {
  const actions = useVehicleActions(ws);
  const readOnly = actions.available.length === 0;
  const index = useMemo(() => buildIndex(ws), [ws]);
  const [filter, setFilter] = useState<FilterId>("all");
  const [query, setQuery] = useState("");
  const [thread, setThread] = useState<string | null>(null);
  const [hoverThread, setHoverThread] = useState<string | null>(null);
  const storyRef = useRef<HTMLElement>(null);

  const ctx: StoryCtx = {
    ws,
    actions,
    index,
    readOnly,
    activeThread: thread,
    hoverThread,
    setHoverThread,
    showThread: (key) => {
      setThread(key);
      setFilter("all");
      setQuery("");
      setHoverThread(null);
      requestAnimationFrame(() => storyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    },
  };

  return (
    <Ctx.Provider value={ctx}>
      {/* The shell header turns translucent when a branch is in force; this
          opaque strip sits under it so the scrolling story never shows through. */}
      <div aria-hidden className="pointer-events-none sticky top-0 z-[9] -mt-14 h-14 shrink-0 bg-background" />
      <div className="mx-auto w-full max-w-7xl px-4 pt-4 pb-44 lg:px-6 lg:pt-6 lg:pb-28">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid min-w-0 grid-cols-1 gap-3 lg:hidden">
            <PhoneHeader />
          </div>

          <div className="grid min-w-0 grid-cols-1 content-start gap-6">
            {readOnly ? <ReadOnlyNote /> : <Composer />}
            <OpenThreads />
            <Story
              storyRef={storyRef}
              filter={filter}
              setFilter={(f) => {
                setFilter(f);
                setThread(null);
              }}
              query={query}
              setQuery={setQuery}
              thread={thread}
              clearThread={() => setThread(null)}
            />
          </div>

          <aside className="hidden lg:block" aria-label={`${ws.vehicle.code} at a glance`}>
            {/* Only the card sticks; money and documents scroll up beneath it, so nothing is clipped. */}
            <div className="sticky top-14 z-[6] -mt-4 bg-background pt-4 pb-4">
              <VehicleCard compact={false} />
            </div>
            <div className="grid gap-4">
              <MoneyPanel />
              <DocumentsPanel />
              <SpecsDisclosure />
            </div>
          </aside>
        </div>
      </div>
      {!readOnly && <PhoneActionBar />}
      {actions.sheet}
    </Ctx.Provider>
  );
}

// ------------------------------------------------------------- small pieces

function Tag({ tone, icon: Icon, children, className }: { tone: Tone; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap", TONE_TAG[tone], className)}>
      {Icon && <Icon className="size-3" aria-hidden />}
      {children}
    </span>
  );
}

function ToneIcon({ icon: Icon, tone, className }: { icon: LucideIcon; tone: Tone; className?: string }) {
  return (
    <span className={cn("grid size-8 shrink-0 place-items-center rounded-full bg-background", className)}>
      <span className={cn("grid size-full place-items-center rounded-full ring-1", TONE_ICON[tone])}>
        <Icon className="size-4" aria-hidden />
      </span>
    </span>
  );
}

function StepButton({ step, onBefore }: { step: Step; onBefore?: () => void }) {
  const { actions } = useStory();
  const Icon = actionByKey(step.key).icon;
  return (
    <Button
      size="sm"
      variant="outline"
      className="max-lg:h-9 max-lg:px-3"
      onClick={() => {
        onBefore?.();
        actions.open(step.key, step.ref);
      }}
    >
      <Icon aria-hidden />
      {step.label}
    </Button>
  );
}

function RichText({ text, prefer }: { text: string; prefer: RefPrefer }) {
  const { index } = useStory();
  if (!index.tokenRe) return <>{text}</>;
  const parts = text.split(index.tokenRe);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <RefLink key={`${part}-${i}`} token={part} prefer={prefer} /> : <Fragment key={`t-${i}`}>{part}</Fragment>,
      )}
    </>
  );
}

// ------------------------------------------------------------ ref popovers

function RefLink({ token, prefer, className }: { token: string; prefer: RefPrefer; className?: string }) {
  const { ws } = useStory();
  const [open, setOpen] = useState(false);
  const target = resolveRef(ws, token, prefer);
  if (!target) return <span className="tabular-nums">{token}</span>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "cursor-pointer rounded-sm font-medium text-foreground tabular-nums underline decoration-foreground/30 underline-offset-[3px] hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          className,
        )}
      >
        {token}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-3 p-3.5">
        <RefDetail target={target} close={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 text-foreground">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function RefDetail({ target, close }: { target: RefTarget; close: () => void }) {
  const { ws, actions, index, showThread } = useStory();
  const threadKey = threadKeyForTarget(target);
  const threadEvents = threadKey ? (index.threadSize.get(threadKey) ?? 0) : 0;
  const followThread =
    threadKey && threadEvents > 0 ? (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          close();
          showThread(threadKey);
        }}
      >
        <Link2 aria-hidden />
        Show in story ({threadEvents})
      </Button>
    ) : null;

  let header: ReactNode;
  let body: ReactNode;
  let steps: Step[] = [];
  let extra: ReactNode = null;

  switch (target.kind) {
    case "WORK_ORDER": {
      const wo = target.wo;
      const done = wo.checklist.filter((c) => c.done).length;
      header = (
        <RefHeader icon={Wrench} token={wo.ref}>
          <Tag tone={wo.status === "CLOSED" ? "success" : wo.status === "CANCELLED" ? "neutral" : wo.status === "OPEN" ? "info" : "warning"}>
            {WORK_ORDER_STATUS_LABELS[wo.status]}
          </Tag>
        </RefHeader>
      );
      body = (
        <>
          <p className="font-medium leading-snug">{wo.title}</p>
          <Facts
            rows={[
              ["Assigned to", wo.assignee],
              ...(wo.issueRef ? [["From problem", wo.issueRef] as [string, ReactNode]] : []),
              ...(wo.dueBy ? [["Due", `${formatDate(wo.dueBy)}, ${dueText(wo.dueBy).replace(/^due /, "")}`] as [string, ReactNode]] : []),
              ["Expected", wo.expectedCostMinor !== null ? formatXaf(wo.expectedCostMinor) : "Not set"],
              ["Actual", wo.actualCostMinor !== null ? formatXaf(wo.actualCostMinor) : "Not yet"],
              ...(wo.checklist.length > 0 ? [["Checklist", `${done} of ${wo.checklist.length} steps done`] as [string, ReactNode]] : []),
            ]}
          />
          {wo.costLines.length > 0 && (
            <ul className="grid gap-1 rounded-md bg-muted/60 p-2 text-xs">
              {wo.costLines.map((c) => (
                <li key={c.label} className="flex justify-between gap-3">
                  <span className="min-w-0">
                    {c.label}
                    <span className="block text-muted-foreground">
                      {c.entryNumber ? `${c.entryNumber} · ${c.entryStatus ? ENTRY_STATUS_LABELS[c.entryStatus] : ""}` : "No expense entry"}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatXaf(c.amountMinor)}</span>
                </li>
              ))}
            </ul>
          )}
          {wo.summary && <p className="text-xs text-muted-foreground">{wo.summary}</p>}
        </>
      );
      steps = workOrderSteps(wo, actions.can);
      extra = actions.can("open-work-order") ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            close();
            actions.open("open-work-order", wo.ref);
          }}
        >
          <Eye aria-hidden />
          Open
        </Button>
      ) : null;
      break;
    }
    case "ISSUE": {
      const issue = target.issue;
      header = (
        <RefHeader icon={TriangleAlert} token={issue.ref}>
          <Tag tone={issue.status === "OPEN" ? "warning" : issue.status === "RESOLVED" ? "success" : "neutral"}>{ISSUE_STATUS_LABELS[issue.status]}</Tag>
          {issue.safetyCritical && <Tag tone="critical">Safety-critical</Tag>}
        </RefHeader>
      );
      body = (
        <>
          <p className="font-medium leading-snug">{issue.title}</p>
          <p className="text-xs text-muted-foreground">{issue.description}</p>
          <Facts
            rows={[
              ["Category", issue.category],
              ["Reported", `${issue.reportedBy}, ${formatDateTime(issue.reportedAt)}`],
              ["Photos", issue.photos > 0 ? String(issue.photos) : "None"],
              ["Work order", issue.workOrderRef ?? "None yet"],
            ]}
          />
        </>
      );
      steps = issueSteps(issue, actions.can);
      break;
    }
    case "ENTRY": {
      const e = target.entry;
      const share = e.amountMinor !== e.entryTotalMinor;
      header = (
        <RefHeader icon={e.direction === "REVENUE" ? Banknote : Receipt} token={e.number}>
          <Tag tone={e.status === "POSTED" ? "success" : e.status === "SUBMITTED" ? "warning" : "neutral"}>{ENTRY_STATUS_LABELS[e.status]}</Tag>
        </RefHeader>
      );
      body = (
        <>
          <p className="font-medium leading-snug">
            {e.direction === "REVENUE" ? "Revenue" : "Expense"} · {e.category}
            {e.counterparty ? ` · ${e.counterparty}` : ""}
          </p>
          <Facts
            rows={[
              [share ? "This vehicle's share" : "Amount", <span className="font-medium tabular-nums">{formatXaf(e.amountMinor)}</span>],
              ...(share ? [["Whole entry", `${formatXaf(e.entryTotalMinor)}, split across vehicles`] as [string, ReactNode]] : []),
              ["Economic date", formatDate(e.economicDate)],
              ["Cost layer", LAYER_LABELS[e.layer]],
              ["Recorded by", e.recordedBy],
              ["Receipt", e.evidence === "ATTACHED" ? "Attached" : <span className="text-amber-700 dark:text-amber-300">Not supplied</span>],
              ...(e.link ? [["Linked to", `${e.link.kind === "WORK_ORDER" ? "Work order" : e.link.kind === "TRIP" ? "Trip" : "Document"} ${e.link.ref}`] as [string, ReactNode]] : []),
            ]}
          />
          <p className="text-xs text-muted-foreground">
            {e.status === "SUBMITTED"
              ? "Not counted in posted spend until finance approves it."
              : e.status === "POSTED"
                ? "Posted records the cost; it does not prove payment."
                : "Kept in the history; not counted in totals."}
          </p>
        </>
      );
      steps = entrySteps(e, actions.can);
      if (e.status === "POSTED" && actions.can("reverse-entry")) steps.push({ key: "reverse-entry", label: "Reverse", ref: e.number });
      break;
    }
    case "TRIP": {
      const t = target.trip;
      header = (
        <RefHeader icon={Route} token={t.number}>
          <Tag tone={t.status === "OPEN" ? "info" : "neutral"}>{t.status === "OPEN" ? "Open" : "Closed"}</Tag>
          {t.exceptions > 0 && <Tag tone="warning">{t.exceptions} exceptions</Tag>}
        </RefHeader>
      );
      body = (
        <>
          <p className="font-medium leading-snug">
            {t.from} → {t.to}
          </p>
          <Facts
            rows={[
              ["Type", t.type],
              ["Customer", t.customer ?? "None"],
              ["Driver", t.driver],
              ["Started", formatDateTime(t.startedAt)],
              ["Ended", t.endedAt ? formatDateTime(t.endedAt) : "Still open"],
              ["Distance", t.distanceKm !== null ? `${t.distanceKm.toLocaleString("en-US")} km` : "Not yet"],
              ["Revenue", t.revenueMinor !== null ? formatXaf(t.revenueMinor) : "None recorded"],
              ["Costs", formatXaf(t.costMinor)],
            ]}
          />
        </>
      );
      break;
    }
    case "DOCUMENT": {
      const d = target.doc;
      header = (
        <RefHeader icon={FileText} token={d.number ?? shortDocType(d.type)}>
          <DocStateTag doc={d} />
        </RefHeader>
      );
      body = (
        <>
          <p className="font-medium leading-snug">{d.type}</p>
          <Facts
            rows={[
              ["Issued", d.issuedAt ? formatDate(d.issuedAt) : "Not recorded"],
              ["Expires", d.expiresAt ? formatDate(d.expiresAt) : "No expiry date"],
              ["File", d.hasFile ? "Attached" : "Not uploaded"],
              ["Earlier versions", d.previousVersions > 0 ? `${d.previousVersions} kept` : "None"],
            ]}
          />
        </>
      );
      if (actions.can("renew-document") && d.state !== "NO_EXPIRY") steps = [{ key: "renew-document", label: "Renew", ref: d.id }];
      break;
    }
  }

  const hasActions = steps.length > 0 || extra !== null || followThread !== null;
  return (
    <>
      {header}
      {body}
      {hasActions && (
        <div className="flex flex-wrap gap-1.5 border-t pt-3">
          {extra}
          {steps.map((s) => (
            <StepButton key={s.key} step={s} onBefore={close} />
          ))}
          {followThread}
        </div>
      )}
    </>
  );
}

function RefHeader({ icon: Icon, token, children }: { icon: LucideIcon; token: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      <span className="text-sm font-semibold tabular-nums">{token}</span>
      {children}
    </div>
  );
}

function DocStateTag({ doc }: { doc: VehicleDocument }) {
  switch (doc.state) {
    case "EXPIRED":
      return (
        <Tag tone="critical" icon={OctagonAlert}>
          Expired {doc.expiresAt ? shortDate(doc.expiresAt) : ""}
        </Tag>
      );
    case "EXPIRING":
      return (
        <Tag tone="warning" icon={Clock}>
          Expires in {doc.daysLeft ?? "?"} days
        </Tag>
      );
    case "VALID":
      return (
        <Tag tone="success" icon={CircleCheck}>
          Valid to {doc.expiresAt ? shortDate(doc.expiresAt) : "?"}
        </Tag>
      );
    case "NO_EXPIRY":
      return <Tag tone="neutral">No expiry date</Tag>;
  }
}

// ------------------------------------------------------------ composer

function composerKeys(role: ProtoRole, can: Actions["can"]): ActionKey[] {
  return COMPOSER_KEYS[role].filter((k) => can(k));
}

function Composer() {
  const { ws, actions } = useStory();
  const keys = composerKeys(actions.role, actions.can);
  return (
    <section aria-labelledby="vb-composer" className="hidden rounded-xl bg-card p-4 ring-1 ring-foreground/10 lg:block">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="vb-composer" className="text-base font-semibold">
          Add to {ws.vehicle.code}'s story
        </h2>
        <p className="text-xs text-muted-foreground">Recorded as {ROLE_LABELS[actions.role]} · every entry keeps your name and the time</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {keys.map((k) => {
          const a = actionByKey(k);
          return (
            <Button key={k} variant="outline" size="lg" className="px-3" title={a.label} onClick={() => actions.open(k, defaultRef(ws, k))}>
              <a.icon aria-hidden />
              {COMPOSER_LABELS[k] ?? a.short}
            </Button>
          );
        })}
        <MoreMenu exclude={keys} />
      </div>
    </section>
  );
}

function remainingGroups(byGroup: Actions["byGroup"], exclude: readonly ActionKey[]): Array<{ group: string; actions: VehicleAction[] }> {
  return byGroup
    .map((g) => ({ group: g.group, actions: g.actions.filter((a) => !exclude.includes(a.key)) }))
    .filter((g) => g.actions.length > 0);
}

function MoreMenu({ exclude }: { exclude: readonly ActionKey[] }) {
  const { ws, actions } = useStory();
  const groups = remainingGroups(actions.byGroup, exclude);
  if (groups.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="lg" className="px-3" />}>
        <Ellipsis aria-hidden />
        More
        <ChevronDown className="text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {groups.map((g, i) => (
          <Fragment key={g.group}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel>{g.group}</DropdownMenuLabel>
              {g.actions.map((a) => (
                <DropdownMenuItem key={a.key} onClick={() => actions.open(a.key, defaultRef(ws, a.key))}>
                  <a.icon aria-hidden />
                  {a.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ReadOnlyNote() {
  const { ws, actions } = useStory();
  return (
    <p className="flex items-start gap-2 rounded-xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground ring-1 ring-foreground/5">
      <Eye className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        Read-only as <span className="font-medium text-foreground">{ROLE_LABELS[actions.role].replace(/\s*\(read-only\)$/, "")}</span>: all of{" "}
        {ws.vehicle.code}'s story is visible; nothing can be changed here.
      </span>
    </p>
  );
}

function PhoneActionBar() {
  const { ws, actions } = useStory();
  const [moreOpen, setMoreOpen] = useState(false);
  const top = composerKeys(actions.role, actions.can).slice(0, 3);
  const groups = remainingGroups(actions.byGroup, []);
  return (
    <>
      <div className="fixed inset-x-3 bottom-[80px] z-40 lg:hidden">
        <nav
          aria-label={`Add to ${ws.vehicle.code}'s story`}
          className="mx-auto flex max-w-md items-stretch gap-1 rounded-xl border bg-card/95 p-1 shadow-lg backdrop-blur supports-backdrop-filter:bg-card/85"
        >
          {top.map((k) => {
            const a = actionByKey(k);
            return (
              <Button key={k} variant="ghost" className="h-12 flex-1 flex-col gap-0.5 px-1 text-xs" onClick={() => actions.open(k, defaultRef(ws, k))}>
                <a.icon className="size-5" aria-hidden />
                {COMPOSER_LABELS[k] ?? a.short}
              </Button>
            );
          })}
          <Button variant="ghost" className="h-12 flex-1 flex-col gap-0.5 px-1 text-xs" onClick={() => setMoreOpen(true)}>
            <Ellipsis className="size-5" aria-hidden />
            More
          </Button>
        </nav>
      </div>
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] gap-0 overflow-y-auto rounded-t-xl">
          <SheetHeader className="border-b">
            <SheetTitle>Add to {ws.vehicle.code}'s story</SheetTitle>
            <SheetDescription>Everything you can do on this vehicle as {ROLE_LABELS[actions.role]}.</SheetDescription>
          </SheetHeader>
          <div className="grid gap-5 p-4">
            {groups.map((g) => (
              <div key={g.group}>
                <p className="mb-2 text-xs font-medium text-muted-foreground">{g.group}</p>
                <div className="grid grid-cols-2 gap-2">
                  {g.actions.map((a) => (
                    <Button
                      key={a.key}
                      variant="outline"
                      className="h-auto min-h-11 justify-start px-3 py-2 text-left whitespace-normal"
                      onClick={() => {
                        setMoreOpen(false);
                        actions.open(a.key, defaultRef(ws, a.key));
                      }}
                    >
                      <a.icon aria-hidden />
                      {a.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------- open threads

function OpenThreads() {
  const { ws, actions, readOnly } = useStory();
  const [expanded, setExpanded] = useState(false);
  const threads = buildOpenThreads(ws, actions.can);
  if (threads.length === 0) {
    return (
      <section aria-labelledby="vb-threads">
        <h2 id="vb-threads" className="text-base font-semibold">
          Open threads
        </h2>
        <p className="mt-2 rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing is in motion. Every problem, work order, entry and document is settled.
        </p>
      </section>
    );
  }
  const focus = ROLE_FOCUS[actions.role];
  const inFocus = (t: OpenThread) => (focus && t.steps.some((s) => actionByKey(s.key).group === focus) ? 0 : 1);
  const mine = readOnly ? [] : threads.filter((t) => t.steps.length > 0).sort((a, b) => inFocus(a) - inFocus(b));
  const others = threads.filter((t) => !mine.includes(t));
  const ordered = [...mine, ...others];
  const PHONE_LIMIT = 3;
  const hiddenOnPhone = expanded ? 0 : Math.max(0, ordered.length - PHONE_LIMIT);

  return (
    <section aria-labelledby="vb-threads">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id="vb-threads" className="text-base font-semibold">
          Open threads
        </h2>
        <span className="text-xs text-muted-foreground">{threads.length} still in motion</span>
      </div>
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {mine.length > 0 && <ThreadGroupLabel>Your next steps · {mine.length}</ThreadGroupLabel>}
        <ul className="divide-y">
          {mine.map((t, i) => (
            <ThreadRow key={t.id} thread={t} hideOnPhone={i >= PHONE_LIMIT && !expanded} />
          ))}
        </ul>
        {others.length > 0 && (
          <ThreadGroupLabel className={cn(mine.length > 0 && "border-t", mine.length >= PHONE_LIMIT && !expanded && "max-lg:hidden")}>
            {readOnly ? "In motion" : "Waiting on others"} · {others.length}
          </ThreadGroupLabel>
        )}
        <ul className="divide-y">
          {others.map((t, i) => (
            <ThreadRow key={t.id} thread={t} hideOnPhone={mine.length + i >= PHONE_LIMIT && !expanded} />
          ))}
        </ul>
        {hiddenOnPhone > 0 && (
          <button
            type="button"
            className="flex h-11 w-full items-center justify-center gap-1 border-t text-sm font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground lg:hidden"
            onClick={() => setExpanded(true)}
          >
            Show {hiddenOnPhone} more
            <ChevronDown className="size-4" aria-hidden />
          </button>
        )}
      </div>
    </section>
  );
}

function ThreadGroupLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground", className)}>{children}</p>;
}

function ThreadRow({ thread: t, hideOnPhone }: { thread: OpenThread; hideOnPhone: boolean }) {
  const { index, showThread } = useStory();
  const followable = t.threadKey !== null && (index.threadSize.get(t.threadKey) ?? 0) > 0;
  return (
    <li className={cn("flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4", hideOnPhone && "max-lg:hidden")}>
      <div className="flex min-w-0 flex-1 gap-3">
        <ToneIcon icon={t.icon} tone={t.tone} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <RefLink token={t.token} prefer={t.prefer} className="text-sm" />
            {followable && t.threadKey ? (
              <button
                type="button"
                title="Show its story"
                className="min-w-0 cursor-pointer text-left text-sm font-medium underline-offset-[3px] hover:underline"
                onClick={() => showThread(t.threadKey ?? "")}
              >
                {t.title}
              </button>
            ) : (
              <span className="min-w-0 text-sm font-medium">{t.title}</span>
            )}
            <Tag tone={t.stateTone}>{t.state}</Tag>
          </div>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{t.meta}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-11 sm:pl-0">
        {t.steps.length > 0 ? (
          t.steps.map((s) => <StepButton key={s.key} step={s} />)
        ) : (
          <span className="text-xs text-muted-foreground">Waiting on {t.waitingOn}</span>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- story

function Story({
  storyRef,
  filter,
  setFilter,
  query,
  setQuery,
  thread,
  clearThread,
}: {
  storyRef: RefObject<HTMLElement | null>;
  filter: FilterId;
  setFilter: (f: FilterId) => void;
  query: string;
  setQuery: (q: string) => void;
  thread: string | null;
  clearThread: () => void;
}) {
  const { ws, index } = useStory();
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(49);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setBarHeight(el.offsetHeight));
    observer.observe(el);
    setBarHeight(el.offsetHeight);
    return () => observer.disconnect();
  }, []);

  const q = query.trim().toLowerCase();
  const kinds = FILTERS.find((f) => f.id === filter)?.kinds ?? null;
  const events = ws.timeline
    .filter((ev) => {
      if (thread) {
        if (index.threadOf.get(ev.id) !== thread) return false;
      } else if (kinds && !kinds.includes(ev.kind)) return false;
      if (q && !`${ev.title} ${ev.detail ?? ""} ${ev.actor} ${ev.ref ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => b.at.localeCompare(a.at));

  const days: Array<{ key: string; events: TimelineEvent[] }> = [];
  for (const ev of events) {
    const key = localDayKey(ev.at);
    const last = days[days.length - 1];
    if (last && last.key === key) last.events.push(ev);
    else days.push({ key, events: [ev] });
  }

  const oldest = [...ws.timeline].sort((a, b) => a.at.localeCompare(b.at))[0];
  const unfiltered = !thread && filter === "all" && !q;
  const stickyTop = 56 + barHeight;

  return (
    <section ref={storyRef} aria-labelledby="vb-story" className="scroll-mt-16">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="vb-story" className="text-base font-semibold">
            {ws.vehicle.code}'s story
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {ws.timeline.length} events{oldest ? ` since ${monthYear(localDayKey(oldest.at))}` : ""}, newest first. Nothing is edited away: corrections appear as their own
            events.
          </p>
        </div>
        <div className="relative w-full sm:w-60">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the story" aria-label="Search the story" className="h-9 pr-8 pl-8" />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setQuery("")}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div ref={barRef} className="sticky top-14 z-[6] -mx-4 mt-3 border-b bg-background px-4 py-2 lg:mx-0 lg:px-0">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0" role="toolbar" aria-label="Filter the story by kind">
          {FILTERS.map((f) => {
            const count = f.kinds ? ws.timeline.filter((ev) => f.kinds?.includes(ev.kind)).length : ws.timeline.length;
            const active = !thread && filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                disabled={count === 0}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-40",
                  active ? "border-foreground bg-foreground text-background" : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {f.label}
                <span className={cn("tabular-nums", active ? "opacity-70" : "opacity-60")}>{count}</span>
              </button>
            );
          })}
        </div>
        {(thread || q) && (
          <div className="mt-2 flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-sm">
            {thread ? <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
            <p className="min-w-0 flex-1 truncate">
              {thread ? (
                <>
                  Showing the <span className="font-medium">{threadLabel(ws, thread)}</span> thread
                  <span className="text-muted-foreground"> · {threadTitle(ws, thread)}</span>
                </>
              ) : (
                <>
                  Matching <span className="font-medium">“{query.trim()}”</span>
                </>
              )}
              <span className="text-muted-foreground"> · {events.length} {events.length === 1 ? "event" : "events"}</span>
            </p>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                clearThread();
                setQuery("");
              }}
            >
              Clear
            </Button>
          </div>
        )}
      </div>

      {days.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed px-5 py-10 text-center">
          <Search className="mx-auto size-5 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-sm text-muted-foreground">Nothing in {ws.vehicle.code}'s story matches this filter.</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => {
              clearThread();
              setQuery("");
              setFilter("all");
            }}
          >
            Show the whole story
          </Button>
        </div>
      ) : (
        <ol className="mt-1">
          {days.map((day, i) => {
            const newer = days[i - 1];
            const gapDays = newer ? daysBetween(day.key, newer.key) : 0;
            const heading = dayHeading(day.key);
            return (
              <li key={day.key}>
                {unfiltered && newer && gapDays > 60 && (
                  <div className="flex items-center gap-3 py-3 text-xs text-muted-foreground">
                    <span className="h-px flex-1 border-t border-dashed" />
                    Nothing recorded between {monthYear(day.key)} and {monthYear(newer.key)}
                    <span className="h-px flex-1 border-t border-dashed" />
                  </div>
                )}
                <h3 className="sticky z-[5] flex items-baseline gap-2 bg-background py-2 text-sm font-semibold" style={{ top: stickyTop }}>
                  {heading.primary}
                  {heading.secondary && <span className="text-xs font-normal text-muted-foreground">{heading.secondary}</span>}
                </h3>
                <ol className="relative pb-2 before:absolute before:top-3 before:bottom-3 before:left-[15.5px] before:w-px before:bg-border">
                  {day.events.map((ev) => (
                    <StoryEvent key={ev.id} ev={ev} />
                  ))}
                </ol>
              </li>
            );
          })}
        </ol>
      )}

      {unfiltered && oldest && (
        <p className="mt-2 flex items-center gap-2 border-t pt-4 text-xs text-muted-foreground">
          <Flag className="size-3.5" aria-hidden />
          Start of {ws.vehicle.code}'s story · {oldest.title}, {formatDate(oldest.at)}
        </p>
      )}
    </section>
  );
}

function StoryEvent({ ev }: { ev: TimelineEvent }) {
  const { ws, actions, index, readOnly, hoverThread } = useStory();
  const meta = KIND_META[ev.kind];
  const prefer: RefPrefer = ev.kind === "TRIP" ? "TRIP" : "ENTRY";
  const threadKey = index.threadOf.get(ev.id) ?? null;
  const highlighted = hoverThread !== null && threadKey === hoverThread;
  const steps = readOnly ? [] : eventSteps(ws, ev, actions.can);
  const entry = ev.kind === "EXPENSE" || ev.kind === "REVENUE" || ev.kind === "APPROVAL" ? ws.entries.find((e) => e.number === ev.ref) : undefined;
  const issue = ev.kind === "ISSUE" || ev.kind === "GROUNDED" ? ws.issues.find((i) => i.ref === ev.ref) : undefined;
  const text = `${ev.title} ${ev.detail ?? ""}`;
  const refOutsideText = ev.ref !== null && index.tokenRe !== null && !text.includes(ev.ref) && resolveRef(ws, ev.ref, prefer) !== null && !ev.ref.startsWith("doc-");

  return (
    <li className="relative flex gap-3">
      <ToneIcon icon={meta.icon} tone={ev.tone} className="relative z-[1] mt-2" />
      <div className={cn("min-w-0 flex-1 rounded-lg px-3 py-2 ring-1 ring-transparent transition-colors", highlighted && "bg-muted/70 ring-border")}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-5 font-medium">
              <RichText text={ev.title} prefer={prefer} />
            </p>
            {ev.detail && (
              <p className="mt-0.5 text-sm leading-5 text-muted-foreground">
                <RichText text={ev.detail} prefer={prefer} />
              </p>
            )}
          </div>
          {ev.amountMinor !== null && <EventAmount ev={ev} entry={entry} layout="side" />}
        </div>
        {ev.amountMinor !== null && <EventAmount ev={ev} entry={entry} layout="inline" />}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>
            {ev.actor === "System" ? "Recorded automatically" : ev.actor}
            {ev.actor !== "System" && <span className="tabular-nums"> · {timeOf(ev.at)}</span>}
          </span>
          {refOutsideText && ev.ref && <RefLink token={ev.ref} prefer={prefer} />}
          {issue?.safetyCritical && <Tag tone="critical">Safety-critical</Tag>}
          {entry?.evidence === "MISSING" && (
            <Tag tone="warning" icon={Paperclip}>
              No receipt
            </Tag>
          )}
          <ThreadChip ev={ev} threadKey={threadKey} />
        </div>
        {steps.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {steps.map((s) => (
              <StepButton key={s.key} step={s} />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function EventAmount({ ev, entry, layout }: { ev: TimelineEvent; entry: MoneyEntry | undefined; layout: "side" | "inline" }) {
  if (ev.amountMinor === null) return null;
  const pending = entry?.status === "SUBMITTED";
  const workOrderCost = ev.kind === "WORK_ORDER" || ev.kind === "RELEASED";
  let caption: string;
  switch (ev.kind) {
    case "REVENUE":
      caption = `Revenue · ${entry ? ENTRY_STATUS_LABELS[entry.status] : "Posted"}`;
      break;
    case "REVERSAL":
      caption = "Reversal · Posted";
      break;
    case "WORK_ORDER":
    case "RELEASED":
      caption = "Work order actual";
      break;
    default:
      caption = entry ? `Expense · ${ENTRY_STATUS_LABELS[entry.status]}` : "Expense";
  }
  const amount = (
    <span
      className={cn(
        "text-sm font-semibold tabular-nums",
        pending && "text-amber-700 dark:text-amber-300",
        workOrderCost && "font-medium text-muted-foreground",
      )}
    >
      {formatXaf(ev.amountMinor, { signed: ev.kind === "REVENUE" })}
    </span>
  );
  const label = (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", pending && "text-amber-700 dark:text-amber-300")}>
      {pending && <Clock className="size-3" aria-hidden />}
      {caption}
    </span>
  );
  if (layout === "inline") {
    return (
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 sm:hidden">
        {amount}
        {label}
      </p>
    );
  }
  return (
    <div className="hidden shrink-0 flex-col items-end text-right sm:flex">
      {amount}
      {label}
    </div>
  );
}

function ThreadChip({ ev, threadKey }: { ev: TimelineEvent; threadKey: string | null }) {
  const { ws, index, activeThread, setHoverThread, showThread } = useStory();
  if (!threadKey || activeThread === threadKey) return null;
  const size = index.threadSize.get(threadKey) ?? 0;
  if (size < 2) return null;
  const label = threadLabel(ws, threadKey);
  const head = ev.ref === threadKey;
  return (
    <button
      type="button"
      title={`Show only the ${label} thread`}
      className="inline-flex h-5 cursor-pointer items-center gap-1 rounded-md border border-dashed border-foreground/20 px-1.5 text-xs text-muted-foreground transition-colors hover:border-solid hover:bg-background hover:text-foreground"
      onMouseEnter={() => setHoverThread(threadKey)}
      onMouseLeave={() => setHoverThread(null)}
      onFocus={() => setHoverThread(threadKey)}
      onBlur={() => setHoverThread(null)}
      onClick={() => showThread(threadKey)}
    >
      <Link2 className="size-3" aria-hidden />
      {head ? `${label} thread` : `Part of ${label}`}
      <span className="tabular-nums opacity-70">· {size}</span>
    </button>
  );
}

// ------------------------------------------------------------ vehicle rail

function ReadinessBlock() {
  const { ws } = useStory();
  const r = ws.readiness;
  if (r.state === "GROUNDED") {
    const days = daysBetween(localDayKey(r.since), TODAY);
    const wo = r.workOrderRef ? ws.workOrders.find((w) => w.ref === r.workOrderRef) : undefined;
    return (
      <div className="rounded-lg bg-red-500/[0.07] p-3 ring-1 ring-red-500/25">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
          <OctagonAlert className="size-5 shrink-0" aria-hidden />
          <p className="text-base font-semibold">Grounded</p>
          <span className="ml-auto text-xs font-medium tabular-nums">{days === 0 ? "since today" : `for ${days} ${days === 1 ? "day" : "days"}`}</span>
        </div>
        <p className="mt-1.5 text-sm leading-5 font-medium">{r.reason}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Since {formatDateTime(r.since)} · safety-critical report <RefLink token={r.issueRef} prefer="ENTRY" /> by {r.reportedBy}
        </p>
        {wo && (
          <p className="mt-2 flex gap-1.5 border-t border-red-500/15 pt-2 text-xs leading-5">
            <Wrench className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              Repair <RefLink token={wo.ref} prefer="ENTRY" /> is {WORK_ORDER_STATUS_LABELS[wo.status].toLowerCase()}
              {wo.dueBy ? `, ${dueText(wo.dueBy)}` : ""}. Release to service needs it closed and signed off.
            </span>
          </p>
        )}
      </div>
    );
  }
  if (r.state === "AVAILABLE") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-emerald-500/[0.07] p-3 text-emerald-800 ring-1 ring-emerald-500/25 dark:text-emerald-300">
        <CircleCheck className="size-5 shrink-0" aria-hidden />
        <p className="text-base font-semibold">Available</p>
        <span className="ml-auto text-xs">since {formatDateTime(r.since)}</span>
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-muted p-3">
      <p className="text-base font-semibold">Availability not assessed</p>
      <p className="text-xs text-muted-foreground">No readiness check has been recorded for this vehicle.</p>
    </div>
  );
}

function VehicleCard({ compact }: { compact: boolean }) {
  const { ws } = useStory();
  const v = ws.vehicle;
  const lastTrip = [...ws.trips].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const loc = ws.location;
  const c = ws.custodian;
  const makeModel = v.displayName !== v.code ? v.displayName : [v.make, v.model].filter(Boolean).join(" ");
  const facts: Array<{ icon: LucideIcon; label: string; value: ReactNode; sub: ReactNode }> = [
    {
      icon: UserRound,
      label: "Custodian",
      value: c ? c.name : "No custodian",
      sub: c ? (
        <>
          {c.kind}, since {shortDate(c.since)}
          {!compact && (
            <>
              <a
                href={`tel:${c.phone.replace(/\s/g, "")}`}
                className="block w-fit whitespace-nowrap tabular-nums underline decoration-foreground/30 underline-offset-[3px] hover:decoration-foreground"
              >
                {c.phone}
              </a>
              {lastTrip && lastTrip.driver !== c.name && <span className="block">Accountable, not the driver: {lastTrip.driver} drove the last trip.</span>}
            </>
          )}
        </>
      ) : (
        "Nobody is accountable yet"
      ),
    },
    {
      icon: MapPin,
      label: compact ? "Reported location" : "Location",
      value: loc.state === "REPORTED" ? loc.place : "No report",
      sub:
        loc.state === "REPORTED"
          ? `Reported ${formatDateTime(loc.observedAt)}${compact ? "" : ` · ${loc.source.toLowerCase()}`}`
          : "Nobody has reported where it is",
    },
    {
      icon: Gauge,
      label: "Odometer",
      value: `${ws.meter.odometerKm.toLocaleString("en-US")} km`,
      sub: compact
        ? `${shortDate(ws.meter.observedAt)}, by ${ws.meter.observedBy}`
        : `${shortDate(ws.meter.observedAt)}, ${ws.meter.source.toLowerCase()}, ${ws.meter.observedBy} · ${ws.meter.km30d.toLocaleString("en-US")} km in 30 days`,
    },
    {
      icon: Building2,
      label: "Home branch",
      value: v.homeBranch.name,
      sub: compact ? "Not its location" : "Administrative home, not location",
    },
  ];

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl leading-tight font-semibold tabular-nums">{v.code}</h1>
        <span className="text-sm text-muted-foreground tabular-nums">{v.plate ?? "Plate not recorded"}</span>
      </div>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {[makeModel || null, v.year ? String(v.year) : null, v.classLabel].filter(Boolean).join(" · ")}
      </p>

      <div className="mt-3">
        <ReadinessBlock />
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Flag className="size-3.5" aria-hidden />
        Lifecycle: <span className="font-medium text-foreground">{LIFECYCLE_LABELS[v.lifecycle]}</span>
        {v.commissionedAt && v.lifecycle === "IN_SERVICE" ? <span>since {formatDate(v.commissionedAt)}</span> : null}
      </p>

      {compact ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3">
          {facts.map((f) => (
            <div key={f.label} className="flex min-w-0 gap-2">
              <f.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{f.label}</dt>
                <dd className="text-sm leading-5 font-medium">{f.value}</dd>
                <dd className="text-xs leading-5 text-muted-foreground">{f.sub}</dd>
              </div>
            </div>
          ))}
        </dl>
      ) : (
        <dl className="mt-3 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 border-t pt-3">
          {facts.map((f) => (
            <Fragment key={f.label}>
              <dt className="flex items-center gap-1.5 self-start pt-px text-xs text-muted-foreground">
                <f.icon className="size-3.5 shrink-0" aria-hidden />
                {f.label}
              </dt>
              <dd className="min-w-0">
                <span className="block text-sm leading-5 font-medium">{f.value}</span>
                <span className="block text-xs leading-5 text-muted-foreground">{f.sub}</span>
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
    </section>
  );
}

function Panel({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside && <div className="text-xs text-muted-foreground">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

function MoneyPanel() {
  const { ws, actions } = useStory();
  const m = ws.money;
  const pendingEntry = ws.entries.find((e) => e.status === "SUBMITTED");
  const missing = ws.entries.filter((e) => e.evidence === "MISSING" && (e.status === "POSTED" || e.status === "SUBMITTED"));
  const firstMissing = missing[0];
  return (
    <Panel title="This month" aside={m.periodLabel}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted-foreground">Posted expenses</span>
        <span className="text-xl font-semibold tabular-nums">{formatXaf(m.postedExpenseMinor)}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        This vehicle's share, posted in {m.periodLabel}. Direct, maintenance and ownership costs. Posted is not paid.
      </p>

      <dl className="mt-3 divide-y border-y text-sm">
        <div className="flex items-start justify-between gap-3 py-2.5">
          <div>
            <dt className="flex items-center gap-1.5">
              <Clock className="size-3.5 text-amber-700 dark:text-amber-300" aria-hidden />
              Awaiting review
            </dt>
            <dd className="text-xs text-muted-foreground">
              {m.pendingReviewCount} {m.pendingReviewCount === 1 ? "entry" : "entries"} · not included above
            </dd>
          </div>
          <dd className="text-right">
            <span className="font-medium tabular-nums">{formatXaf(m.pendingReviewMinor)}</span>
            {pendingEntry && actions.can("review-entry") && (
              <Button size="xs" variant="outline" className="mt-1 flex" onClick={() => actions.open("review-entry", pendingEntry.number)}>
                Review
              </Button>
            )}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-3 py-2.5">
          <div>
            <dt className="flex items-center gap-1.5">
              <Paperclip className="size-3.5 text-amber-700 dark:text-amber-300" aria-hidden />
              Missing receipts
            </dt>
            <dd className="text-xs text-muted-foreground">
              {firstMissing ? `${firstMissing.category}, ${formatXaf(firstMissing.amountMinor)} · ${firstMissing.counterparty ?? "no counterparty"}` : "Every entry has its proof"}
            </dd>
          </div>
          <dd className="text-right">
            <span className="font-medium tabular-nums">
              {m.missingEvidenceCount} {m.missingEvidenceCount === 1 ? "entry" : "entries"}
            </span>
            {firstMissing && actions.can("attach-receipt") && (
              <Button size="xs" variant="outline" className="mt-1 flex" onClick={() => actions.open("attach-receipt", firstMissing.number)}>
                Attach
              </Button>
            )}
          </dd>
        </div>
        <div className="py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <dt>Cost per km</dt>
            <dd className="font-medium tabular-nums">{m.costPerKm ? `${formatXaf(m.costPerKm.minor)}/km` : "Not enough readings"}</dd>
          </div>
          {m.costPerKm && <dd className="mt-0.5 text-xs leading-5 text-muted-foreground">Basis: {m.costPerKm.basis}</dd>}
        </div>
      </dl>

      <p className="mt-3 text-xs font-medium text-muted-foreground">Posted, by category</p>
      <ul className="mt-1.5 grid gap-1 text-sm">
        {m.byCategory.map((c) => (
          <li key={c.label} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0">
              {c.label} <span className="text-xs text-muted-foreground">{LAYER_LABELS[c.layer]}</span>
            </span>
            <span className="tabular-nums">{formatXaf(c.minor)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t pt-2.5 text-xs leading-5 text-muted-foreground">
        Since registration: {formatXaf(m.lifetime.expenseMinor)} expenses, {formatXaf(m.lifetime.revenueMinor)} revenue, net{" "}
        {formatXaf(m.lifetime.netMinor, { signed: true })}.
      </p>
    </Panel>
  );
}

function DocumentsPanel() {
  const { ws, actions } = useStory();
  const expired = ws.documents.filter((d) => d.state === "EXPIRED").length;
  const expiring = ws.documents.filter((d) => d.state === "EXPIRING").length;
  const summary = [expired ? `${expired} expired` : null, expiring ? `${expiring} expiring` : null].filter(Boolean).join(" · ") || "All current";
  return (
    <Panel title="Documents" aside={summary}>
      <ul className="-my-2 divide-y">
        {ws.documents.map((d) => (
          <li key={d.id} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm leading-5 font-medium">{shortDocType(d.type)}</p>
              <p className="text-xs leading-5 text-muted-foreground">
                {d.number ? <RefLink token={d.number} prefer="ENTRY" className="font-normal" /> : "No number"}
                {!d.hasFile && " · no file uploaded"}
                {d.previousVersions > 0 && ` · ${d.previousVersions} earlier ${d.previousVersions === 1 ? "version" : "versions"}`}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <DocStateTag doc={d} />
              {(d.state === "EXPIRED" || d.state === "EXPIRING") && actions.can("renew-document") && (
                <Button size="xs" variant="outline" onClick={() => actions.open("renew-document", d.id)}>
                  Renew
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {actions.can("add-document") && (
        <Button size="sm" variant="ghost" className="mt-3 -ml-2" onClick={() => actions.open("add-document")}>
          <FilePlus2 aria-hidden />
          Add document
        </Button>
      )}
    </Panel>
  );
}

function SpecsDisclosure() {
  const { ws } = useStory();
  const v = ws.vehicle;
  const rows: Array<[string, string]> = [
    ["Make and model", [v.make, v.model].filter(Boolean).join(" ") || "Not recorded"],
    ["Year", v.year ? String(v.year) : "Not recorded"],
    ["Chassis", v.chassis ?? "Not recorded"],
    ["Capacity", v.capacity ?? "Not recorded"],
    ...v.specs.map((s): [string, string] => [s.label, s.value]),
    ["Acquired", v.acquisition.date ? `${formatDate(v.acquisition.date)}${v.acquisition.amountMinor !== null ? ` · ${formatXaf(v.acquisition.amountMinor)}` : ""}` : "Not recorded"],
    ["Commissioned", v.commissionedAt ? formatDate(v.commissionedAt) : "Not yet"],
  ];
  return (
    <details className="group rounded-xl bg-card ring-1 ring-foreground/10">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-semibold hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
        Specifications and acquisition
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t px-4 py-3 text-sm">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 text-right tabular-nums break-words">{value}</dd>
          </Fragment>
        ))}
      </dl>
    </details>
  );
}

function PhoneHeader() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <VehicleCard compact />
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 items-center justify-between rounded-xl bg-card px-4 text-sm font-medium ring-1 ring-foreground/10 hover:bg-muted/40"
      >
        Money, documents and specifications
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <>
          <MoneyPanel />
          <DocumentsPanel />
          <SpecsDisclosure />
        </>
      )}
    </>
  );
}
