import { z } from "zod";

/** Page size used when a list query omits `limit`. */
export const LIST_LIMIT_DEFAULT = 50;
/** Server-side ceiling: a client can never ask for an unbounded page. */
export const LIST_LIMIT_MAX = 100;

export const sortDirections = ["asc", "desc"] as const;
export type SortDirection = (typeof sortDirections)[number];

export interface ListSort<TField extends string = string> {
  field: TField;
  direction: SortDirection;
}

export interface ListQueryOptions<TField extends string> {
  /** Fields this resource may be sorted by. Omitted means `sort` is rejected. */
  sortFields?: readonly TField[];
  defaultLimit?: number;
  maxLimit?: number;
}

/** `{ [key]: item[], nextCursor }` — the shape every list read returns. */
export type ListResponse<TItem, TKey extends string = "items"> = {
  [K in TKey]: TItem[];
} & { nextCursor: string | null };

function isSortDirection(value: string): value is SortDirection {
  return (sortDirections as readonly string[]).includes(value);
}

function sortSchema<TField extends string>(fields: readonly TField[]) {
  const allowed = new Set<string>(fields);
  return z
    .string()
    .transform((value, ctx): ListSort<TField> => {
      const [field, direction = "asc", ...rest] = value.split(":");
      if (
        rest.length > 0 ||
        field === undefined ||
        !allowed.has(field) ||
        !isSortDirection(direction)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "sort must be <field>:asc|desc over a sortable field",
        });
        return z.NEVER;
      }
      return { field: field as TField, direction };
    })
    .optional();
}

function limitSchema(defaultLimit: number, maxLimit: number) {
  return z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit);
}

/**
 * Extends a resource's filter shape with the shared list controls: `sort`
 * (`field:asc`), an opaque keyset `cursor`, and a bounded `limit`. Unknown keys
 * are stripped, so a query string carrying extras is still accepted.
 */
export function listQuery<
  TFilters extends Record<string, z.ZodType>,
  TField extends string = never,
>(filters: TFilters, options: ListQueryOptions<TField> = {}) {
  const {
    sortFields = [],
    defaultLimit = LIST_LIMIT_DEFAULT,
    maxLimit = LIST_LIMIT_MAX,
  } = options;

  return z.object({
    ...filters,
    sort: sortSchema<TField>(sortFields),
    cursor: z.string().optional(),
    limit: limitSchema(defaultLimit, maxLimit),
  });
}

/**
 * The list envelope. `key` exists only so `/v1/finance/entries` can keep its
 * published `entries` key (ADR-0003); new resources take the `items` default.
 */
export function listResponse<
  TItem extends z.ZodType,
  TKey extends string = "items",
>(item: TItem, options: { key?: TKey } = {}) {
  const key = options.key ?? "items";

  return z.object({
    [key]: z.array(item),
    nextCursor: z.string().nullable(),
  }) as unknown as z.ZodObject<
    { [K in TKey]: z.ZodArray<TItem> } & {
      nextCursor: z.ZodNullable<z.ZodString>;
    }
  >;
}
