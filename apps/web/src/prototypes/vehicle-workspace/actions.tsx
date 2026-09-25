// PROTOTYPE — throwaway, issue #44. Every action a vehicle can have, who may
// take it (server rules on develop / the maintenance branch), and whether it
// exists yet. Opening an action shows the form it would use with the vehicle
// pinned; nothing is submitted.

import { useState, type ReactNode } from "react";
import { useSearch } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  BadgeCheck,
  Ban,
  CalendarClock,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardPlus,
  Fuel,
  Gauge,
  Handshake,
  Paperclip,
  PlayCircle,
  Receipt,
  RefreshCcw,
  Route,
  ShieldCheck,
  StickyNote,
  TriangleAlert,
  Undo2,
  UserRound,
  Wrench,
  FileCheck2,
  FilePlus2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type { ProtoRole, VehicleWorkspace } from "./mockData.js";

export type BuildStatus = "live" | "maintenance-branch" | "new";

export type ActionGroup = "Capture" | "Maintenance" | "Operations" | "Documents" | "Money" | "Lifecycle";

export type ActionKey =
  | "log-fuel"
  | "record-expense"
  | "attach-receipt"
  | "record-reading"
  | "add-note"
  | "report-issue"
  | "create-work-order"
  | "open-work-order"
  | "approve-work-order"
  | "complete-work-order"
  | "approve-closure"
  | "cancel-work-order"
  | "release-to-service"
  | "schedule-service"
  | "start-trip"
  | "assign-custodian"
  | "transfer-branch"
  | "report-location"
  | "add-document"
  | "renew-document"
  | "record-revenue"
  | "review-entry"
  | "reverse-entry"
  | "commission"
  | "dispose";

interface Field {
  label: string;
  type: "text" | "number" | "money" | "date" | "datetime" | "select" | "textarea" | "toggle" | "file" | "pinned";
  value?: string;
  hint?: string;
  options?: string[];
}

export interface VehicleAction {
  key: ActionKey;
  label: string;
  short: string;
  group: ActionGroup;
  icon: LucideIcon;
  roles: readonly ProtoRole[];
  status: BuildStatus;
  command: string | null;
  description: string;
  primary: string;
  fields: (ws: VehicleWorkspace, ref: string | null) => Field[];
}

const FIELD_ROLES = ["ADMIN", "OPS_MANAGER", "FIELD_SUBMITTER"] as const;
const MONEY_ROLES = ["ADMIN", "OPS_MANAGER", "FIELD_SUBMITTER", "FINANCE_APPROVER"] as const;
const WORKSHOP_ROLES = ["ADMIN", "OPS_MANAGER", "MAINTENANCE"] as const;
const DECIDERS = ["ADMIN", "FINANCE_APPROVER"] as const;
const MANAGERS = ["ADMIN", "OPS_MANAGER"] as const;

const pinned = (ws: VehicleWorkspace): Field => ({
  label: "Vehicle",
  type: "pinned",
  value: `${ws.vehicle.code} · ${ws.vehicle.plate ?? "no plate"} · ${ws.vehicle.homeBranch.name}`,
});

export const ACTIONS: readonly VehicleAction[] = [
  {
    key: "log-fuel",
    label: "Log fuel",
    short: "Fuel",
    group: "Capture",
    icon: Fuel,
    roles: MONEY_ROLES,
    status: "live",
    command: "record-expense.v1 (FUEL) + record-meter-reading.v1",
    description: "One form: litres, amount, odometer and the receipt photo. Posts a FUEL expense and a reading together.",
    primary: "Save fuel",
    fields: (ws) => [
      pinned(ws),
      { label: "Amount paid", type: "money", hint: "Up to 100,000 XAF posts directly; above goes to finance review" },
      { label: "Litres", type: "number", hint: "New: stored with the expense for L/100 km" },
      { label: "Odometer (km)", type: "number", value: String(ws.meter.odometerKm), hint: `Last: ${ws.meter.odometerKm.toLocaleString("en-US")} km` },
      { label: "Station", type: "text", value: "" },
      { label: "Date", type: "date", value: "2026-09-25" },
      { label: "Receipt photo", type: "file" },
    ],
  },
  {
    key: "record-expense",
    label: "Record expense",
    short: "Expense",
    group: "Capture",
    icon: Receipt,
    roles: MONEY_ROLES,
    status: "live",
    command: "record-expense.v1",
    description: "Any cost for this vehicle. It can be linked to a trip or a work order so it is counted once and shows in both.",
    primary: "Record",
    fields: (ws, ref) => [
      pinned(ws),
      { label: "Category", type: "select", options: ["Repairs", "Tyres", "Fuel", "Tolls", "Parking", "Insurance", "Driver allowance"] },
      { label: "Amount", type: "money" },
      { label: "Economic date", type: "date", value: "2026-09-25" },
      { label: "Linked to", type: "select", value: ref ?? "", options: ["None", ...ws.workOrders.filter((w) => w.status === "OPEN").map((w) => `${w.ref} · ${w.title}`), ...ws.trips.slice(0, 2).map((t) => `${t.number} · trip`)] },
      { label: "Counterparty", type: "text" },
      { label: "Receipt", type: "file" },
    ],
  },
  {
    key: "attach-receipt",
    label: "Attach receipt",
    short: "Receipt",
    group: "Capture",
    icon: Paperclip,
    roles: MONEY_ROLES,
    status: "new",
    command: "attach-evidence.v1 (new)",
    description: "Adds proof to an entry that was recorded without it. The entry itself is not edited; the attachment is its own audited record.",
    primary: "Attach",
    fields: (ws, ref) => [pinned(ws), { label: "Entry", type: "pinned", value: ref ?? "Choose an entry" }, { label: "Photo or PDF", type: "file" }],
  },
  {
    key: "record-reading",
    label: "Record odometer",
    short: "Odometer",
    group: "Capture",
    icon: Gauge,
    roles: FIELD_ROLES,
    status: "live",
    command: "record-meter-reading.v1",
    description: "A standalone reading. A lower value than the last one is saved with a warning, never refused.",
    primary: "Save reading",
    fields: (ws) => [
      pinned(ws),
      { label: "Odometer (km)", type: "number", hint: `Last: ${ws.meter.odometerKm.toLocaleString("en-US")} km, ${ws.meter.source.toLowerCase()}` },
      { label: "Observed at", type: "datetime", value: "2026-09-25T08:00" },
      { label: "Dashboard photo", type: "file", hint: "Optional" },
    ],
  },
  {
    key: "add-note",
    label: "Add note",
    short: "Note",
    group: "Capture",
    icon: StickyNote,
    roles: ["ADMIN", "OPS_MANAGER", "FIELD_SUBMITTER", "MAINTENANCE", "FINANCE_APPROVER"],
    status: "new",
    command: "add-note.v1 (catalog §5.1, not built)",
    description: "A short remark on the vehicle's history. Notes are append-only.",
    primary: "Add note",
    fields: (ws) => [pinned(ws), { label: "Note", type: "textarea" }],
  },
  {
    key: "report-issue",
    label: "Report a problem",
    short: "Problem",
    group: "Maintenance",
    icon: TriangleAlert,
    roles: ["ADMIN", "OPS_MANAGER", "FIELD_SUBMITTER", "MAINTENANCE"],
    status: "maintenance-branch",
    command: "report-issue.v1",
    description: "Anyone who drives or works on the vehicle can report. Marking it safety-critical grounds the vehicle immediately.",
    primary: "Report",
    fields: (ws) => [
      pinned(ws),
      { label: "What is wrong?", type: "textarea" },
      { label: "Category", type: "select", options: ["Brakes", "Engine", "Tyres", "Electrical", "Body", "Comfort", "Other"] },
      { label: "Safety-critical: ground the vehicle now", type: "toggle", hint: "Only a manager can release it again, after a closed work order" },
      { label: "Photos", type: "file" },
    ],
  },
  {
    key: "create-work-order",
    label: "Create work order",
    short: "Work order",
    group: "Maintenance",
    icon: ClipboardPlus,
    roles: WORKSHOP_ROLES,
    status: "maintenance-branch",
    command: "create-work-order.v1",
    description: "Plan the work: what, who, by when, and the expected cost. Can start from a reported problem.",
    primary: "Create",
    fields: (ws, ref) => [
      pinned(ws),
      { label: "From problem", type: "select", value: ref ?? "", options: ["None", ...ws.issues.filter((i) => i.status === "OPEN").map((i) => `${i.ref} · ${i.title}`)] },
      { label: "Work to do", type: "textarea" },
      { label: "Assigned to", type: "select", options: [...ws.people.technicians, ...ws.people.garages] },
      { label: "Due by", type: "date" },
      { label: "Expected cost", type: "money", hint: "Above the threshold, finance authorizes before work starts" },
      { label: "Checklist", type: "textarea", hint: "New: one step per line, ticked off by the technician" },
    ],
  },
  {
    key: "open-work-order",
    label: "Open work order",
    short: "Open",
    group: "Maintenance",
    icon: Wrench,
    roles: ["ADMIN", "OPS_MANAGER", "MAINTENANCE", "FIELD_SUBMITTER", "FINANCE_APPROVER", "EXECUTIVE_VIEWER"],
    status: "maintenance-branch",
    command: "GET /v1/work-orders/:id",
    description: "The work order with its checklist, costs and chronology.",
    primary: "Close",
    fields: (ws, ref) => {
      const wo = ws.workOrders.find((w) => w.ref === ref) ?? ws.workOrders[0];
      if (!wo) return [pinned(ws)];
      return [
        pinned(ws),
        { label: "Work order", type: "pinned", value: `${wo.ref} · ${wo.title}` },
        { label: "Assigned to", type: "pinned", value: wo.assignee },
        { label: "Checklist", type: "pinned", value: wo.checklist.map((c) => `${c.done ? "✓" : "○"} ${c.label}`).join("\n") || "No checklist" },
        { label: "Costs so far", type: "pinned", value: wo.costLines.map((c) => `${c.label}: ${c.amountMinor.toLocaleString("en-US")} XAF`).join("\n") || "None yet" },
      ];
    },
  },
  {
    key: "approve-work-order",
    label: "Authorize work order",
    short: "Authorize",
    group: "Maintenance",
    icon: BadgeCheck,
    roles: DECIDERS,
    status: "maintenance-branch",
    command: "approve-work-order.v1",
    description: "Finance authorizes spending before work starts. The creator cannot authorize their own order.",
    primary: "Authorize",
    fields: (ws, ref) => [pinned(ws), { label: "Work order", type: "pinned", value: ref ?? "" }, { label: "Note", type: "textarea" }],
  },
  {
    key: "complete-work-order",
    label: "Complete work",
    short: "Complete",
    group: "Maintenance",
    icon: ClipboardCheck,
    roles: WORKSHOP_ROLES,
    status: "maintenance-branch",
    command: "complete-work-order.v1",
    description: "Say what was done and what it cost. Parts and labour are recorded as expenses linked to this order.",
    primary: "Mark complete",
    fields: (ws, ref) => [
      pinned(ws),
      { label: "Work order", type: "pinned", value: ref ?? "" },
      { label: "What was done", type: "textarea" },
      { label: "Actual cost", type: "money" },
      { label: "Odometer at completion", type: "number", value: String(ws.meter.odometerKm) },
      { label: "Invoice or photos", type: "file" },
    ],
  },
  {
    key: "approve-closure",
    label: "Sign off work order",
    short: "Sign off",
    group: "Maintenance",
    icon: ClipboardCheck,
    roles: DECIDERS,
    status: "maintenance-branch",
    command: "approve-work-order-closure.v1",
    description: "Checks the completed work and its actual cost. Whoever completed it cannot sign it off.",
    primary: "Sign off",
    fields: (ws, ref) => {
      const wo = ws.workOrders.find((w) => w.ref === ref);
      return [
        pinned(ws),
        { label: "Work order", type: "pinned", value: wo ? `${wo.ref} · ${wo.title}` : (ref ?? "") },
        { label: "Summary", type: "pinned", value: wo?.summary ?? "" },
        { label: "Cost", type: "pinned", value: wo ? `${(wo.actualCostMinor ?? 0).toLocaleString("en-US")} XAF actual · ${(wo.expectedCostMinor ?? 0).toLocaleString("en-US")} XAF expected` : "" },
        { label: "Note", type: "textarea" },
      ];
    },
  },
  {
    key: "cancel-work-order",
    label: "Cancel work order",
    short: "Cancel",
    group: "Maintenance",
    icon: Ban,
    roles: WORKSHOP_ROLES,
    status: "maintenance-branch",
    command: "cancel-work-order.v1",
    description: "A reason is required. Costs already recorded stay; cancelled orders cannot receive new ones.",
    primary: "Cancel order",
    fields: (ws, ref) => [pinned(ws), { label: "Work order", type: "pinned", value: ref ?? "" }, { label: "Reason", type: "textarea" }],
  },
  {
    key: "release-to-service",
    label: "Release to service",
    short: "Release",
    group: "Maintenance",
    icon: ShieldCheck,
    roles: MANAGERS,
    status: "maintenance-branch",
    command: "release-asset-to-service.v1",
    description: "Ends the grounding. Needs a closed work order; after a safety-critical problem the person who did the work cannot release.",
    primary: "Release",
    fields: (ws) => [
      pinned(ws),
      { label: "Closed work order", type: "select", options: ws.workOrders.filter((w) => w.status === "CLOSED").map((w) => `${w.ref} · ${w.title}`) },
      { label: "Road test done", type: "toggle" },
      { label: "Note", type: "textarea" },
    ],
  },
  {
    key: "schedule-service",
    label: "Schedule service",
    short: "Service",
    group: "Maintenance",
    icon: CalendarClock,
    roles: WORKSHOP_ROLES,
    status: "new",
    command: "schedule-service.v1 (new, deferred in §13 as preventive scheduling)",
    description: "A reminder every N km or N days, e.g. oil change every 20,000 km. It suggests a work order; it never creates one on its own.",
    primary: "Save schedule",
    fields: (ws) => [pinned(ws), { label: "Service", type: "text", value: "Oil and filters" }, { label: "Every", type: "text", value: "20,000 km or 6 months" }, { label: "Last done", type: "text", value: "178,400 km · 2 Jun 2026" }],
  },
  {
    key: "start-trip",
    label: "Start a trip",
    short: "Trip",
    group: "Operations",
    icon: Route,
    roles: FIELD_ROLES,
    status: "live",
    command: "create-activity.v1 (or the trip sheet)",
    description: "Opens a trip with this truck as the primary vehicle, the driver and the starting odometer.",
    primary: "Start trip",
    fields: (ws) => [
      pinned(ws),
      { label: "Trip type", type: "select", options: ["Haulage job", "Transfer", "Maintenance run"] },
      { label: "Driver", type: "select", options: ws.people.drivers },
      { label: "Customer", type: "text" },
      { label: "From → to", type: "text", value: "Douala → " },
      { label: "Starting odometer", type: "number", value: String(ws.meter.odometerKm) },
    ],
  },
  {
    key: "assign-custodian",
    label: "Change custodian",
    short: "Custodian",
    group: "Operations",
    icon: UserRound,
    roles: MANAGERS,
    status: "live",
    command: "assign-asset.v1 (custodian; API only today)",
    description: "Who is accountable for the vehicle day to day. Not the same as who drives each trip.",
    primary: "Assign",
    fields: (ws) => [
      pinned(ws),
      { label: "Current", type: "pinned", value: ws.custodian ? `${ws.custodian.name} since ${ws.custodian.since}` : "None" },
      { label: "New custodian", type: "select", options: ws.people.drivers },
      { label: "Handover odometer", type: "number", value: String(ws.meter.odometerKm) },
      { label: "Handover note", type: "textarea", hint: "New: condition, fuel level, tools on board" },
    ],
  },
  {
    key: "transfer-branch",
    label: "Transfer home branch",
    short: "Transfer",
    group: "Operations",
    icon: ArrowLeftRight,
    roles: ["ADMIN", "OPS_MANAGER", "FINANCE_APPROVER"],
    status: "live",
    command: "assign-asset.v1 (branch)",
    description: "A permanent move. Past costs stay with the branch that incurred them. Cross-branch moves need a finance approver.",
    primary: "Transfer",
    fields: (ws) => [pinned(ws), { label: "From", type: "pinned", value: ws.vehicle.homeBranch.name }, { label: "To", type: "select", options: ["Yaoundé", "Bafoussam"] }, { label: "Reason", type: "textarea" }],
  },
  {
    key: "report-location",
    label: "Report location",
    short: "Location",
    group: "Operations",
    icon: Handshake,
    roles: FIELD_ROLES,
    status: "new",
    command: "report-location.v1 (new; #46 decides authority)",
    description: "Where the vehicle is right now, as reported by a person. No GPS. Being somewhere grants no one new authority over it.",
    primary: "Report",
    fields: (ws) => [pinned(ws), { label: "Place", type: "select", options: ["Douala depot", "Yaoundé depot", "Bafoussam depot", "Other…"] }, { label: "Observed at", type: "datetime", value: "2026-09-25T08:00" }],
  },
  {
    key: "add-document",
    label: "Add document",
    short: "Document",
    group: "Documents",
    icon: FilePlus2,
    roles: FIELD_ROLES,
    status: "live",
    command: "add-or-renew-document.v1",
    description: "Insurance, inspection, permits. Expiry drives reminders; a missing expiry date shows as unknown, never as valid.",
    primary: "Add",
    fields: (ws) => [pinned(ws), { label: "Type", type: "select", options: ["Insurance", "Technical inspection", "Transport permit", "Registration"] }, { label: "Number", type: "text" }, { label: "Issued", type: "date" }, { label: "Expires", type: "date" }, { label: "Scan or photo", type: "file" }],
  },
  {
    key: "renew-document",
    label: "Renew document",
    short: "Renew",
    group: "Documents",
    icon: FileCheck2,
    roles: FIELD_ROLES,
    status: "live",
    command: "add-or-renew-document.v1 (supersedes)",
    description: "The old version is kept. The renewal fee is recorded as an expense linked to the document, once.",
    primary: "Renew",
    fields: (ws, ref) => {
      const doc = ws.documents.find((d) => d.id === ref) ?? ws.documents[0];
      return [
        pinned(ws),
        { label: "Renewing", type: "pinned", value: doc ? `${doc.type} · ${doc.number ?? "no number"} · expires ${doc.expiresAt ?? "unknown"}` : "" },
        { label: "New number", type: "text" },
        { label: "Valid from", type: "date", value: "2026-09-25" },
        { label: "Expires", type: "date" },
        { label: "Renewal fee (optional)", type: "money", hint: "Creates one linked expense" },
        { label: "Scan or photo", type: "file" },
      ];
    },
  },
  {
    key: "record-revenue",
    label: "Record revenue",
    short: "Revenue",
    group: "Money",
    icon: CircleDollarSign,
    roles: MONEY_ROLES,
    status: "live",
    command: "record-revenue.v1",
    description: "Transport presets only. Internal fleets are not asked to invent revenue.",
    primary: "Record",
    fields: (ws) => [pinned(ws), { label: "Category", type: "select", options: ["Freight revenue"] }, { label: "Amount", type: "money" }, { label: "Customer", type: "text" }, { label: "Trip", type: "select", options: ws.trips.map((t) => t.number) }],
  },
  {
    key: "review-entry",
    label: "Review entry",
    short: "Review",
    group: "Money",
    icon: BadgeCheck,
    roles: DECIDERS,
    status: "live",
    command: "approve-entry.v1 / reject-entry.v1",
    description: "Approve or reject with the receipt beside the numbers. The person who recorded it cannot approve it.",
    primary: "Approve",
    fields: (ws, ref) => {
      const e = ws.entries.find((x) => x.number === ref) ?? ws.entries[0];
      return [
        pinned(ws),
        { label: "Entry", type: "pinned", value: e ? `${e.number} · ${e.category} · ${e.amountMinor.toLocaleString("en-US")} XAF · by ${e.recordedBy}` : "" },
        { label: "Evidence", type: "pinned", value: e?.evidence === "ATTACHED" ? "Receipt attached" : "No receipt" },
        { label: "Note or rejection reason", type: "textarea" },
      ];
    },
  },
  {
    key: "reverse-entry",
    label: "Reverse entry",
    short: "Reverse",
    group: "Money",
    icon: Undo2,
    roles: DECIDERS,
    status: "live",
    command: "reverse-entry.v1",
    description: "Posted money is never edited: a negative entry cancels it, and both stay in the history.",
    primary: "Reverse",
    fields: (ws, ref) => [pinned(ws), { label: "Entry", type: "pinned", value: ref ?? "" }, { label: "Reason", type: "textarea" }],
  },
  {
    key: "commission",
    label: "Commission",
    short: "Commission",
    group: "Lifecycle",
    icon: PlayCircle,
    roles: MANAGERS,
    status: "live",
    command: "commission-asset.v1",
    description: "Registered → in service.",
    primary: "Commission",
    fields: (ws) => [pinned(ws), { label: "In service from", type: "date", value: "2026-09-25" }],
  },
  {
    key: "dispose",
    label: "Sell, retire or write off",
    short: "Dispose",
    group: "Lifecycle",
    icon: RefreshCcw,
    roles: ["ADMIN"],
    status: "new",
    command: "dispose-asset.v1 (catalog §5.1, not built)",
    description: "Ends the vehicle's life. History stays readable; no new records can be attached afterwards.",
    primary: "Dispose",
    fields: (ws) => [pinned(ws), { label: "How", type: "select", options: ["Sold", "Retired", "Written off"] }, { label: "Date", type: "date" }, { label: "Sale amount", type: "money" }, { label: "Reason", type: "textarea" }],
  },
];

export const GROUP_ORDER: readonly ActionGroup[] = ["Capture", "Maintenance", "Operations", "Documents", "Money", "Lifecycle"];

export const STATUS_LABELS: Record<BuildStatus, string> = {
  live: "Live on develop",
  "maintenance-branch": "Built on the maintenance branch (#47)",
  new: "New: not built yet",
};

export function useProtoRole(): ProtoRole {
  const search = useSearch({ strict: false }) as { as?: ProtoRole };
  return search.as ?? "ADMIN";
}

export function actionByKey(key: ActionKey): VehicleAction {
  const found = ACTIONS.find((a) => a.key === key);
  if (!found) throw new Error(`Unknown action ${key}`);
  return found;
}

export function canDo(role: ProtoRole, key: ActionKey): boolean {
  return actionByKey(key).roles.includes(role);
}

/**
 * One hook per variant: the actions this role may take, and a sheet that
 * previews the form for any of them.
 */
export function useVehicleActions(ws: VehicleWorkspace) {
  const role = useProtoRole();
  const [open, setOpen] = useState<{ key: ActionKey; ref: string | null } | null>(null);
  const available = ACTIONS.filter((a) => a.roles.includes(role) && a.key !== "open-work-order");
  const byGroup = GROUP_ORDER.map((group) => ({ group, actions: available.filter((a) => a.group === group) })).filter((g) => g.actions.length > 0);
  return {
    role,
    available,
    byGroup,
    can: (key: ActionKey) => canDo(role, key),
    open: (key: ActionKey, ref: string | null = null) => setOpen({ key, ref }),
    sheet: <ActionSheet ws={ws} state={open} onClose={() => setOpen(null)} />,
  };
}

function ActionSheet({ ws, state, onClose }: { ws: VehicleWorkspace; state: { key: ActionKey; ref: string | null } | null; onClose: () => void }) {
  const isMobile = useIsMobile();
  const action = state ? actionByKey(state.key) : null;
  return (
    <Sheet open={state !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={isMobile ? "bottom" : "right"} className={cn("gap-0 overflow-y-auto", isMobile ? "max-h-[92vh]" : "sm:max-w-md")}>
        {action && state && (
          <>
            <SheetHeader className="border-b">
              <SheetTitle className="flex items-center gap-2">
                <action.icon className="size-4" aria-hidden />
                {action.label}
              </SheetTitle>
              <SheetDescription>{action.description}</SheetDescription>
              <StatusNote status={action.status} command={action.command} />
            </SheetHeader>
            <div className="grid gap-4 p-4">
              {action.fields(ws, state.ref).map((f) => (
                <FieldPreview key={f.label} field={f} />
              ))}
            </div>
            <SheetFooter className="border-t">
              <Button
                onClick={() => {
                  toast.add({ type: "success", title: "Prototype", description: `${action.label}: nothing was submitted.` });
                  onClose();
                }}
              >
                {action.primary}
              </Button>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function StatusNote({ status, command }: { status: BuildStatus; command: string | null }): ReactNode {
  return (
    <p
      className={cn(
        "mt-2 rounded-md px-2.5 py-1.5 text-xs",
        status === "live" && "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
        status === "maintenance-branch" && "bg-amber-500/10 text-amber-800 dark:text-amber-300",
        status === "new" && "bg-sky-500/10 text-sky-800 dark:text-sky-300",
      )}
    >
      {STATUS_LABELS[status]}
      {command ? ` · ${command}` : ""}
    </p>
  );
}

function FieldPreview({ field }: { field: Field }) {
  const id = `proto-${field.label.replace(/\W+/g, "-").toLowerCase()}`;
  if (field.type === "pinned") {
    return (
      <div className="grid gap-1">
        <span className="text-xs font-medium text-muted-foreground">{field.label}</span>
        <p className="whitespace-pre-line rounded-md bg-muted px-3 py-2 text-sm">{field.value}</p>
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
