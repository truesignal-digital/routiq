import {
  HISTORY_CODE_SETS,
  HISTORY_FIELD_SHAPES,
  type HistoryCodeSet,
  type HistoryDiffChange,
  type HistoryEntityType,
  type HistoryFieldChange,
  type HistoryFieldShape,
  type HistoryName,
  type HistoryNameSource,
} from "@routiq/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  activities,
  assets,
  branches,
  categories,
  documents,
  financialEntries,
  memberships,
  operationalIssues,
  persons,
  postingPeriods,
  principals,
  workOrders,
} from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";

/**
 * Turns the raw allowlisted changes of one event into what the record history
 * sheet can show (#110, #119): codes tagged with the set that words them, ids
 * resolved to names, posting lines summarised. Whatever does not fit its
 * field's shape — an unknown code, an id that names nothing in this
 * workspace, an object where a plain value belongs — is served as
 * `UNAVAILABLE` rather than shown raw or left out: the reader still sees that
 * the field changed. Only money the reader may not see is left out.
 */

const isUuid = (value: string) => z.uuid().safeParse(value).success;

const plain = (text: string): HistoryName => ({ fr: text, en: text });

type Lookup = (tx: TenantTx, workspaceId: string, keys: string[]) => Promise<Map<string, HistoryName>>;

/** Rows keyed by uuid: the id column is uuid-typed, so anything else is not looked up. */
function byId<Row extends { id: string }>(
  query: (tx: TenantTx, workspaceId: string, ids: string[]) => Promise<Row[]>,
  name: (row: Row) => HistoryName | null,
): Lookup {
  return async (tx, workspaceId, keys) => {
    const ids = keys.filter(isUuid);
    const result = new Map<string, HistoryName>();
    if (ids.length === 0) return result;
    for (const row of await query(tx, workspaceId, ids)) {
      const label = name(row);
      if (label !== null) result.set(row.id, label);
    }
    return result;
  };
}

/** A category referenced by its code within one kind, as asset classes and document types are. */
function byCategoryCode(kind: "ASSET_CLASS" | "DOCUMENT_TYPE" | "ISSUE_TYPE"): Lookup {
  return async (tx, workspaceId, codes) => {
    const result = new Map<string, HistoryName>();
    if (codes.length === 0) return result;
    for (const row of await tx
      .select({ code: categories.code, labelFr: categories.labelFr, labelEn: categories.labelEn })
      .from(categories)
      .where(
        and(eq(categories.workspaceId, workspaceId), eq(categories.kind, kind), inArray(categories.code, codes)),
      )) {
      result.set(row.code, { fr: row.labelFr, en: row.labelEn || row.labelFr });
    }
    return result;
  };
}

const LOOKUPS: Record<HistoryNameSource, Lookup> = {
  branch: byId(
    (tx, ws, ids) =>
      tx
        .select({ id: branches.id, name: branches.name })
        .from(branches)
        .where(and(eq(branches.workspaceId, ws), inArray(branches.id, ids))),
    (row) => plain(row.name),
  ),
  category: byId(
    (tx, ws, ids) =>
      tx
        .select({ id: categories.id, labelFr: categories.labelFr, labelEn: categories.labelEn })
        .from(categories)
        .where(and(eq(categories.workspaceId, ws), inArray(categories.id, ids))),
    (row) => ({ fr: row.labelFr, en: row.labelEn || row.labelFr }),
  ),
  assetClass: byCategoryCode("ASSET_CLASS"),
  documentType: byCategoryCode("DOCUMENT_TYPE"),
  issueType: byCategoryCode("ISSUE_TYPE"),
  member: byId(
    (tx, ws, ids) =>
      tx
        .select({ id: memberships.id, displayName: principals.displayName })
        .from(memberships)
        .innerJoin(principals, eq(principals.id, memberships.principalId))
        .where(and(eq(memberships.workspaceId, ws), inArray(memberships.id, ids))),
    (row) => plain(row.displayName),
  ),
  person: byId(
    (tx, ws, ids) =>
      tx
        .select({ id: persons.id, displayName: persons.displayName })
        .from(persons)
        .where(and(eq(persons.workspaceId, ws), inArray(persons.id, ids))),
    (row) => plain(row.displayName),
  ),
  asset: byId(
    (tx, ws, ids) =>
      tx
        .select({ id: assets.id, assetCode: assets.assetCode })
        .from(assets)
        .where(and(eq(assets.workspaceId, ws), inArray(assets.id, ids))),
    (row) => plain(row.assetCode),
  ),
  activity: byId(
    (tx, ws, ids) =>
      tx
        .select({ id: activities.id, activityNumber: activities.activityNumber })
        .from(activities)
        .where(and(eq(activities.workspaceId, ws), inArray(activities.id, ids))),
    (row) => plain(row.activityNumber),
  ),
  entry: byId(
    (tx, ws, ids) =>
      tx
        .select({ id: financialEntries.id, entryNumber: financialEntries.entryNumber })
        .from(financialEntries)
        .where(and(eq(financialEntries.workspaceId, ws), inArray(financialEntries.id, ids))),
    (row) => plain(row.entryNumber),
  ),
  workOrder: byId(
    (tx, ws, ids) =>
      tx
        .select({ id: workOrders.id, description: workOrders.description })
        .from(workOrders)
        .where(and(eq(workOrders.workspaceId, ws), inArray(workOrders.id, ids))),
    (row) => plain(row.description),
  ),
  issue: byId(
    (tx, ws, ids) =>
      tx
        .select({ id: operationalIssues.id, description: operationalIssues.description })
        .from(operationalIssues)
        .where(and(eq(operationalIssues.workspaceId, ws), inArray(operationalIssues.id, ids))),
    (row) => plain(row.description),
  ),
  document: byId(
    (tx, ws, ids) =>
      tx
        .select({ id: documents.id, documentNumber: documents.documentNumber, title: documents.title })
        .from(documents)
        .where(and(eq(documents.workspaceId, ws), inArray(documents.id, ids))),
    (row) => {
      const label = row.documentNumber ?? row.title;
      return label === null || label === "" ? null : plain(label);
    },
  ),
  period: byId(
    (tx, ws, ids) =>
      tx
        .select({ id: postingPeriods.id, periodCode: postingPeriods.periodCode })
        .from(postingPeriods)
        .where(and(eq(postingPeriods.workspaceId, ws), inArray(postingPeriods.id, ids))),
    (row) => plain(row.periodCode),
  ),
};

/** `undefined` means "cannot be shown": the change is served as `UNAVAILABLE`. */
type Side<T> = T | null | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function inSet(codeSet: HistoryCodeSet, value: unknown): value is string {
  return typeof value === "string" && (HISTORY_CODE_SETS[codeSet] as readonly string[]).includes(value);
}

function scalar(value: unknown): Side<string | number | boolean> {
  if (value === null) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  // A uuid under a free-text key is a mis-shaped field, not something to show.
  if (typeof value === "string") return isUuid(value) ? undefined : value;
  return undefined;
}

function code(codeSet: HistoryCodeSet, value: unknown): Side<string> {
  if (value === null) return null;
  return inSet(codeSet, value) ? value : undefined;
}

function codes(codeSet: HistoryCodeSet, value: unknown): Side<string[]> {
  if (value === null) return null;
  if (!Array.isArray(value) || !value.every((item) => inSet(codeSet, item))) return undefined;
  return value as string[];
}

/**
 * Minor units as the writers store them: a number, or the decimal string a
 * bigint column serialises to (`update-approval-threshold`, the before side of
 * `work-orders`). XAF amounts sit far inside the safe integer range.
 */
function minor(value: unknown): Side<number> {
  if (value === null) return null;
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function count(value: unknown): Side<number> {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  return value.length === 0 ? null : value.length;
}

/** Postings sum exactly to their entry, signs included, so the total is the entry's amount. */
function lines(value: unknown, showMoney: boolean): Side<{ count: number; totalMinor: number | null }> {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  let total = 0;
  for (const line of value) {
    const amount = isRecord(line) ? minor(line["amountMinor"]) : undefined;
    if (amount === undefined || amount === null) return undefined;
    total += amount;
  }
  return { count: value.length, totalMinor: showMoney ? total : null };
}

/**
 * The ids a list of records points at through one key: a crew member's
 * `personId` (`create-activity`, `sheet-writer`), a segment's `assetId`.
 */
function listedIds(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (isRecord(item) && typeof item[key] === "string" ? [item[key]] : []));
}

/** Each item's id under `key`, by name; one item that names nothing makes the list unavailable. */
function listedNames(value: unknown, key: string, names: Map<string, HistoryName>): Side<HistoryName[]> {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const result: HistoryName[] = [];
  for (const item of value) {
    const id = isRecord(item) ? item[key] : undefined;
    const name = typeof id === "string" ? names.get(id) : undefined;
    if (name === undefined) return undefined;
    result.push(name);
  }
  return result;
}

function inlineNames(value: unknown): Side<HistoryName[]> {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const result: HistoryName[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item["name"] !== "string") return undefined;
    result.push(plain(item["name"]));
  }
  return result;
}

/**
 * An empty list reads as "none", like a missing key: a creation event that
 * records no crew moved nothing a reader can see, so it is not a change.
 */
function isNothing(value: unknown): boolean {
  return value === null || (Array.isArray(value) && value.length === 0);
}

function shapeOf(entityType: HistoryEntityType, field: string): HistoryFieldShape | undefined {
  return (HISTORY_FIELD_SHAPES[entityType] as Record<string, HistoryFieldShape>)[field];
}

export async function presentChanges(
  tx: TenantTx,
  workspaceId: string,
  entityType: HistoryEntityType,
  changes: readonly HistoryFieldChange[],
  { showMoney }: { showMoney: boolean },
): Promise<HistoryDiffChange[]> {
  // Gather every key each lookup needs, so one event costs one query per source.
  const wanted = new Map<HistoryNameSource, Set<string>>();
  const want = (source: HistoryNameSource, key: unknown) => {
    if (typeof key !== "string") return;
    const keys = wanted.get(source) ?? new Set<string>();
    keys.add(key);
    wanted.set(source, keys);
  };
  for (const change of changes) {
    const shape = shapeOf(entityType, change.field);
    if (shape === "SEGMENT_ASSETS") {
      for (const side of [change.before, change.after]) for (const id of listedIds(side, "assetId")) want("asset", id);
    } else if (shape === "CREW") {
      for (const side of [change.before, change.after]) for (const id of listedIds(side, "personId")) want("person", id);
    } else if (typeof shape === "object" && "name" in shape) {
      want(shape.name, change.before);
      want(shape.name, change.after);
    }
  }
  const names = new Map<HistoryNameSource, Map<string, HistoryName>>();
  for (const [source, keys] of wanted) {
    names.set(source, await LOOKUPS[source](tx, workspaceId, [...keys]));
  }
  const named = (source: HistoryNameSource, value: unknown): Side<HistoryName> => {
    if (value === null) return null;
    return typeof value === "string" ? names.get(source)?.get(value) : undefined;
  };

  const presented: HistoryDiffChange[] = [];
  for (const { field, before, after } of changes) {
    const shape = shapeOf(entityType, field);
    if (shape === undefined || shape === "HIDDEN") continue;

    const both = <T>(read: (value: unknown) => Side<T>): { before: T | null; after: T | null } | undefined => {
      const from = read(before);
      const to = read(after);
      return from === undefined || to === undefined ? undefined : { before: from, after: to };
    };

    let change: Exclude<HistoryDiffChange, { kind: "UNAVAILABLE" }> | undefined;
    if (shape === "VALUE") {
      const sides = both(scalar);
      if (sides) change = { field, kind: "VALUE", ...sides };
    } else if (shape === "MONEY") {
      if (!showMoney) continue;
      const sides = both(minor);
      if (sides) change = { field, kind: "MONEY", ...sides };
    } else if (shape === "COUNT") {
      const sides = both(count);
      if (sides) change = { field, kind: "COUNT", ...sides };
    } else if (shape === "LINES") {
      const sides = both((value) => lines(value, showMoney));
      if (sides) change = { field, kind: "LINES", ...sides };
    } else if (shape === "CREW") {
      const personNames = names.get("person") ?? new Map<string, HistoryName>();
      const sides = both((value) => listedNames(value, "personId", personNames));
      if (sides) change = { field, kind: "NAMES", ...sides };
    } else if (shape === "SEGMENT_ASSETS") {
      const assetNames = names.get("asset") ?? new Map<string, HistoryName>();
      const sides = both((value) => listedNames(value, "assetId", assetNames));
      if (sides) change = { field, kind: "NAMES", ...sides };
    } else if (shape === "INLINE_NAMES") {
      const sides = both(inlineNames);
      if (sides) change = { field, kind: "NAMES", ...sides };
    } else if ("code" in shape) {
      const sides = both((value) => code(shape.code, value));
      if (sides) change = { field, kind: "CODE", codeSet: shape.code, ...sides };
    } else if ("codes" in shape) {
      const sides = both((value) => codes(shape.codes, value));
      if (sides) change = { field, kind: "CODES", codeSet: shape.codes, ...sides };
    } else {
      const source = shape.name;
      const sides = both((value) => named(source, value));
      if (sides) change = { field, kind: "NAME", ...sides };
    }
    if (change === undefined) presented.push({ field, kind: "UNAVAILABLE" });
    else if (!(isNothing(change.before) && isNothing(change.after))) presented.push(change);
  }
  return presented;
}
