import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
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
 * Keyset position for a list ordered `<timestamp> desc nulls last, id asc`.
 * The timestamp is nullable because the sort key itself is (an unposted entry
 * has no `postedAt`), and the id breaks ties into a total order.
 */
export const timestampKeysetCursor = z.object({
  postedAt: z.string().nullable(),
  id: z.uuid(),
});

export type TimestampKeysetCursor = z.infer<typeof timestampKeysetCursor>;

export const timestampKeysetCodec = cursorCodec(timestampKeysetCursor);

/**
 * The rows strictly after `cursor` under `desc nulls last, id asc`. A null
 * cursor timestamp means we are already inside the null tail, where only the
 * id advances; otherwise later pages hold earlier timestamps, tie-broken ids,
 * and the whole null tail.
 */
export function afterTimestampKeyset(
  timestamp: PgColumn,
  id: PgColumn,
  cursor: TimestampKeysetCursor,
): SQL {
  const position = cursor.postedAt === null ? null : new Date(cursor.postedAt);

  if (position === null) {
    return and(isNull(timestamp), sql`${id} > ${cursor.id}`)!;
  }

  return or(
    sql`${timestamp} < ${position}`,
    and(eq(timestamp, position), sql`${id} > ${cursor.id}`),
    isNull(timestamp),
  )!;
}

/**
 * Keyset position for a list ordered `<text> asc, id asc`. The sort key is a
 * non-null text column (an asset always has a code), and the id breaks ties
 * into a total order.
 */
export const textKeysetCursor = z.object({
  key: z.string(),
  id: z.uuid(),
});

export type TextKeysetCursor = z.infer<typeof textKeysetCursor>;

export const textKeysetCodec = cursorCodec(textKeysetCursor);

/**
 * The rows strictly after `cursor` under `<text> asc, id asc`. The comparison
 * runs in the column's collation, the same one the ORDER BY uses, so the
 * boundary can never disagree with the order it paginates.
 */
export function afterTextKeyset(
  key: PgColumn,
  id: PgColumn,
  cursor: TextKeysetCursor,
): SQL {
  return or(
    sql`${key} > ${cursor.key}`,
    and(eq(key, cursor.key), sql`${id} > ${cursor.id}`),
  )!;
}
