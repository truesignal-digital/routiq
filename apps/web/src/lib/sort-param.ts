import type { SortingState } from "@tanstack/react-table";

/**
 * TanStack's sorting state as the reads' `sort` param (`field:asc|desc`).
 *
 * Only the first sort survives: the list reads key their cursor on one column
 * (ADR-0003), so a second would be honoured on the loaded page and silently
 * ignored beyond it. Column ids therefore have to match the read's declared
 * `sortFields`, or the server answers 400.
 */
export function toSortParam(sorting: SortingState): string | undefined {
  const primary = sorting[0];
  if (primary === undefined) return undefined;
  return `${primary.id}:${primary.desc ? "desc" : "asc"}`;
}
