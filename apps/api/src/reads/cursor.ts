import { sortDirections, type ListSort, type SortDirection } from "@routiq/contracts";
import { and, isNull, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

/**
 * Opaque base64url codec over a cursor payload. The payload is validated on
 * decode, so a tampered or stale cursor is `undefined` rather than a crash —
 * callers turn that into `400 VALIDATION_FAILED` (ADR-0003).
 */
export interface CursorCodec<TPayload> {
  encode(payload: TPayload): string;
  decode(cursor: string): TPayload | undefined;
}

export function cursorCodec<TSchema extends z.ZodType>(
  schema: TSchema,
): CursorCodec<z.output<TSchema>> {
  return {
    encode(payload) {
      return Buffer.from(JSON.stringify(payload)).toString("base64url");
    },
    decode(cursor) {
      try {
        const decoded = Buffer.from(cursor, "base64url").toString("utf8");
        const parsed = schema.safeParse(JSON.parse(decoded));
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * A keyset position under an explicitly named sort. The field and direction
 * ride inside the payload so a boundary can only ever be replayed against the
 * ordering that minted it — re-sorting mid-walk would otherwise skip and
 * duplicate rows with no error anywhere (ADR-0003).
 */
export const keysetCursor = z.object({
  field: z.string().min(1),
  direction: z.enum(sortDirections),
  value: z.union([z.string(), z.number(), z.null()]),
  id: z.uuid(),
});

export type KeysetCursor = z.infer<typeof keysetCursor>;
export type KeysetValue = KeysetCursor["value"];

const keysetCodec = cursorCodec(keysetCursor);

export function encodeKeysetCursor(
  sort: ListSort,
  value: KeysetValue,
  id: string,
): string {
  return keysetCodec.encode({
    field: sort.field,
    direction: sort.direction,
    value,
    id,
  });
}

/**
 * Decodes a cursor and refuses it unless it was minted under `sort`. Tampered,
 * stale and mismatched cursors all come back `undefined` — one funnel, so a
 * route cannot answer a re-sorted request with a stale boundary by omission.
 */
export function decodeKeysetCursor(
  cursor: string,
  sort: ListSort,
): KeysetCursor | undefined {
  const decoded = keysetCodec.decode(cursor);
  if (decoded === undefined) return undefined;
  if (decoded.field !== sort.field || decoded.direction !== sort.direction) {
    return undefined;
  }
  return decoded;
}

/**
 * A column a list may be ordered by, plus how to hand a decoded cursor value
 * back to Postgres as a parameter of that column's own type.
 */
export interface KeysetColumn {
  column: PgColumn;
  bind: (value: Exclude<KeysetValue, null>) => SQL;
  /** Nulls sort last in both directions, matching the ORDER BY below. */
  nullable?: boolean;
}

export const bindTimestamp = (value: Exclude<KeysetValue, null>): SQL =>
  sql`${new Date(value)}`;
export const bindDate = (value: Exclude<KeysetValue, null>): SQL =>
  sql`${String(value)}::date`;
export const bindBigint = (value: Exclude<KeysetValue, null>): SQL =>
  sql`${String(value)}::bigint`;
export const bindText = (value: Exclude<KeysetValue, null>): SQL =>
  sql`${String(value)}`;

/** `<column> <direction> [nulls last], id asc` — the id totalises the order. */
export function keysetOrderBy(
  spec: KeysetColumn,
  direction: SortDirection,
  id: PgColumn,
): SQL[] {
  const { column, nullable } = spec;
  const ordered =
    direction === "desc"
      ? nullable
        ? sql`${column} desc nulls last`
        : sql`${column} desc`
      : nullable
        ? sql`${column} asc nulls last`
        : sql`${column} asc`;

  return [ordered, sql`${id} asc`];
}

/**
 * The rows strictly after `cursor` under the same order `keysetOrderBy` emits.
 * A null cursor value means the walk is already inside the null tail, where
 * only the id advances; otherwise later pages hold keys beyond the boundary,
 * its tie-broken ids, and — for a nullable column — the whole null tail.
 */
export function afterKeyset(
  spec: KeysetColumn,
  direction: SortDirection,
  id: PgColumn,
  cursor: KeysetCursor,
): SQL {
  const { column, nullable } = spec;

  if (cursor.value === null) {
    return and(isNull(column), sql`${id} > ${cursor.id}`)!;
  }

  const position = spec.bind(cursor.value);
  const beyond =
    direction === "desc"
      ? sql`${column} < ${position}`
      : sql`${column} > ${position}`;
  const tied = and(sql`${column} = ${position}`, sql`${id} > ${cursor.id}`)!;

  return nullable ? or(beyond, tied, isNull(column))! : or(beyond, tied)!;
}
