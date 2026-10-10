import { z } from "zod";
import { moneyMinor } from "../envelope.js";
import type { Role } from "../roles.js";
import { attentionSeverity } from "./asset-workspace.js";
import { monthCode } from "./finance.js";

/**
 * The Overviews' To do and Coming up (#661, dashboards.html#home): the
 * attention items of every vehicle the caller can see, plus the money waiting
 * on them and the month still to close. Computed by the server inside the
 * caller's whole Branch Scope. The Ambient Branch never narrows them
 * (CONTEXT.md: attention counts the whole Branch Scope), and each response
 * says so in `scope`.
 *
 * Rows carry codes and facts, never sentences: the web words each code.
 */

/**
 * To do rows, in the order the server ranks them: every safety row before
 * every money row. Safety rows most severe first (CRITICAL, WARNING), then in
 * this code order, then oldest first; money rows in code order, the largest
 * amount first.
 */
export const TODO_SAFETY_CODES = [
  /** A vehicle off the road: one row per open grounding. */
  "VEHICLE_GROUNDED",
  /** A reported problem no live work order covers, outside a grounding (the grounded row speaks for that one). */
  "ISSUE_UNPLANNED",
  "DOCUMENT_EXPIRED",
  /** Expires within DOCUMENT_EXPIRING_WINDOW_DAYS, the truck page's own window. */
  "DOCUMENT_EXPIRING",
] as const;

export const TODO_MONEY_CODES = [
  /** Expenses the caller may decide, per currency: count, amount, oldest. */
  "ENTRIES_AWAITING_APPROVAL",
  /** Entries still waiting for a receipt while their month is open, per currency. */
  "ENTRIES_EVIDENCE_MISSING",
  /** The latest past month still OPEN, with what stands in the way of closing it. */
  "PERIOD_OPEN",
] as const;

export const TODO_CODES = [...TODO_SAFETY_CODES, ...TODO_MONEY_CODES] as const;
export const todoCode = z.enum(TODO_CODES);
export type TodoCode = z.infer<typeof todoCode>;

/**
 * Who each To do row waits on: a row is work, so it goes only to the roles
 * that do it. The approvals and new-problem rows follow the navigation counts
 * (NAV_COUNT_ROLES); closing a month follows lock-period; receipts reach the
 * counter too. The driver has My day instead of a To do.
 */
export const TODO_ROLES = {
  VEHICLE_GROUNDED: ["DIRECTOR", "ADMIN", "FINANCE", "TECHNICIAN"],
  ISSUE_UNPLANNED: ["DIRECTOR", "ADMIN", "TECHNICIAN"],
  DOCUMENT_EXPIRED: ["DIRECTOR", "ADMIN", "FINANCE", "TECHNICIAN"],
  DOCUMENT_EXPIRING: ["DIRECTOR", "ADMIN", "FINANCE", "TECHNICIAN"],
  ENTRIES_AWAITING_APPROVAL: ["DIRECTOR", "FINANCE"],
  ENTRIES_EVIDENCE_MISSING: ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER"],
  PERIOD_OPEN: ["DIRECTOR", "FINANCE"],
} as const satisfies Record<TodoCode, readonly Role[]>;

export function todoWaitsOn(code: TodoCode, role: Role): boolean {
  return (TODO_ROLES[code] as readonly Role[]).includes(role);
}

/** Every role some To do row waits on: the read's own gate. */
export const TODO_READER_ROLES = ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER", "TECHNICIAN"] as const satisfies readonly Role[];

export const COMING_UP_CODES = [
  /** A current document expiring inside the window, not yet expired (expired ones are To do). */
  "DOCUMENT_DUE",
  /** PLANNED trips starting inside the window, and how many still have no vehicle. Scheduling only. */
  "TRIPS_PLANNED",
] as const;
export const comingUpCode = z.enum(COMING_UP_CODES);
export type ComingUpCode = z.infer<typeof comingUpCode>;

export const COMING_UP_ROLES = {
  DOCUMENT_DUE: ["DIRECTOR", "ADMIN", "FINANCE", "TECHNICIAN"],
  /** The planners (PLANNING_ROLES, ADR-0012 §7). */
  TRIPS_PLANNED: ["DIRECTOR", "ADMIN", "FINANCE", "TECHNICIAN"],
} as const satisfies Record<ComingUpCode, readonly Role[]>;

export function comingUpWaitsOn(code: ComingUpCode, role: Role): boolean {
  return (COMING_UP_ROLES[code] as readonly Role[]).includes(role);
}

export const COMING_UP_READER_ROLES = ["DIRECTOR", "ADMIN", "FINANCE", "TECHNICIAN"] as const satisfies readonly Role[];

/**
 * Facts ROUTIQ does not record yet, so Coming up cannot count them. The web
 * says they were not counted; it never shows an empty list as "nothing due".
 * SERVICE_DUE_BY_KM: no service interval is recorded per vehicle, so no
 * service can be due by km (dashboards.html#home, "where known").
 */
export const COMING_UP_NOT_COUNTED = ["SERVICE_DUE_BY_KM"] as const;
export const comingUpNotCounted = z.enum(COMING_UP_NOT_COUNTED);

/** Days ahead Coming up looks: the Dashboard's 14, the Trucks Overview's 30. */
export const COMING_UP_WINDOWS = [14, 30] as const;

/** At most this many rows; `totalCount` says how many there were. */
export const FLEET_ATTENTION_ROW_LIMIT = 50;

/**
 * Where a row leads. A record kind with its id, or a list kind (id null) for
 * rows that sum several records: the approvals queue, the entries missing a
 * receipt, the planning board.
 */
export const FLEET_ATTENTION_RECORD_KINDS = [
  "asset",
  "operational_issue",
  "document",
  "posting_period",
] as const;
export const FLEET_ATTENTION_LIST_KINDS = ["approvals", "entries_evidence_missing", "planning"] as const;

const recordLink = z.object({
  kind: z.enum(FLEET_ATTENTION_RECORD_KINDS),
  id: z.uuid(),
  /** Document number, or the period's YYYY-MM; null where the record has none. */
  number: z.string().nullable(),
});
const listLink = z.object({
  kind: z.enum(FLEET_ATTENTION_LIST_KINDS),
  id: z.null(),
  number: z.null(),
});
export const fleetAttentionLink = z.discriminatedUnion("kind", [recordLink, listLink]);

/** The vehicle a row is about; null on rows that sum across vehicles. */
const rowAsset = z.object({ id: z.uuid(), assetCode: z.string() }).nullable();

/**
 * What the lens was: the caller's whole Branch Scope, never the Ambient
 * Branch. A `branchId` in the query is ignored, and `ambientBranch` says so.
 */
export const fleetAttentionScope = z.object({
  ambientBranch: z.literal("IGNORED"),
  /** The branches counted: every one, or the caller's list. */
  branchIds: z.union([z.literal("ALL"), z.array(z.uuid())]),
});

export const todoRow = z.object({
  code: todoCode,
  severity: attentionSeverity,
  link: fleetAttentionLink,
  asset: rowAsset,
  /** The row's branch; null on rows that sum across branches. */
  branchId: z.uuid().nullable(),
  /** Since when this needs attention: the oldest record behind a summed row. */
  since: z.iso.datetime(),
  /** Allowlisted facts for the sentence; every key optional. */
  params: z
    .object({
      /** Sum of the rows behind a summed row; one row per currency. */
      count: z.number().int().positive(),
      amountMinor: moneyMinor,
      currency: z.string().length(3),
      /** Whole business days since `since`. */
      days: z.number().int().nonnegative(),
      description: z.string().max(140),
      safetyCritical: z.boolean(),
      categoryLabelFr: z.string(),
      categoryLabelEn: z.string(),
      /** VEHICLE_GROUNDED: a live work order covers the grounding problem. */
      workOrderPlanned: z.boolean(),
      /** VEHICLE_GROUNDED: the repair is done and the vehicle waits to be released. */
      readyForRelease: z.boolean(),
      documentTypeLabelFr: z.string(),
      documentTypeLabelEn: z.string(),
      expiresAt: z.iso.date(),
      /** Days from the business date to expiry; negative once expired. */
      daysLeft: z.number().int(),
      /** PERIOD_OPEN: the month, its waiting entries and its missing receipts. */
      periodCode: monthCode,
      submittedCount: z.number().int().nonnegative(),
      evidenceMissingCount: z.number().int().nonnegative(),
      /** PERIOD_OPEN: older past months also still open. */
      olderOpenCount: z.number().int().nonnegative(),
    })
    .partial(),
});

export const todoResponse = z.object({
  /** Today in the workspace timezone: what days and expiry were judged against. */
  businessDate: z.iso.date(),
  scope: fleetAttentionScope,
  rows: z.array(todoRow).max(FLEET_ATTENTION_ROW_LIMIT),
  /** Rows before the limit. */
  totalCount: z.number().int().nonnegative(),
});

export const comingUpQuery = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((days) => (COMING_UP_WINDOWS as readonly number[]).includes(days))
    .default(14),
});

export const comingUpRow = z.object({
  code: comingUpCode,
  link: fleetAttentionLink,
  asset: rowAsset,
  branchId: z.uuid().nullable(),
  /** The day it falls due: the expiry, or the first planned start. */
  dueDate: z.iso.date(),
  params: z
    .object({
      documentTypeLabelFr: z.string(),
      documentTypeLabelEn: z.string(),
      daysLeft: z.number().int().nonnegative(),
      plannedCount: z.number().int().positive(),
      withoutVehicleCount: z.number().int().nonnegative(),
    })
    .partial(),
});

export const comingUpResponse = z.object({
  businessDate: z.iso.date(),
  windowDays: z.union([z.literal(14), z.literal(30)]),
  scope: fleetAttentionScope,
  /** Soonest first. */
  rows: z.array(comingUpRow).max(FLEET_ATTENTION_ROW_LIMIT),
  totalCount: z.number().int().nonnegative(),
  /** What could not be counted because ROUTIQ does not record it. */
  notCounted: z.array(comingUpNotCounted),
});

export type FleetAttentionLink = z.infer<typeof fleetAttentionLink>;
export type TodoRow = z.infer<typeof todoRow>;
export type TodoResponse = z.infer<typeof todoResponse>;
export type ComingUpQuery = z.infer<typeof comingUpQuery>;
export type ComingUpRow = z.infer<typeof comingUpRow>;
export type ComingUpResponse = z.infer<typeof comingUpResponse>;
