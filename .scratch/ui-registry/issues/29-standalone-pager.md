# 29 — Standalone pager: `ListPager` + `useKeysetPager`

Status: ready-for-agent
Phase: 6
Blocked by: 28

**What to build:** Lift the keyset paging that currently lives inside `DataTable` into two reusable pieces — a pure `ListPager` component and a `useKeysetPager` hook — so the assets **card grid** (ticket 34) can page identically without becoming a table, and so finance screens can add rows-per-page and totals (ticket 33). `DataTableFooter` becomes an adapter over them; no behaviour regresses.

**Strictly after ticket 28** — same file (`apps/web/src/components/data-table.tsx`), same agent, sequential. Do not start until 28 is committed.

## Design

### What exists today

`apps/web/src/components/data-table.tsx`:

- Keyset state: `keysetPage`, `awaitingFetch`, `keysetPageSize = loadMore?.pageSize ?? LIST_LIMIT_DEFAULT`, `keysetStart`, `hasCachedNextPage` (~lines 405-419), the settle effect that steps the page once rows land, and the reset effect keyed on `JSON.stringify([sortingState, filterValues])` (~lines 421-431).
- Slicing: `modelRows.slice(keysetStart, keysetStart + keysetPageSize)` (~line 517).
- `DataTableFooter` (~lines 798-960) with two modes, `counted` (TanStack table, has first/prev/next/last + rows-per-page select) and `keyset` (prev/next + « Page N », no total, no jumps).
- `DataTableLoadMore` interface (~line 157): `{ hasNextPage, isFetching, onLoadMore, pageSize? }`.

### `hooks/useKeysetPager.ts` — new file

Extract the keyset logic verbatim in behaviour, generic over the row type:

```ts
export interface KeysetPagerSource {
  hasNextPage: boolean;
  isFetching: boolean;
  onLoadMore: () => void;
  pageSize?: number;
  /** Any change resets to page 1 — sort, filters, page size. Stringify it. */
  resetKey?: string;
}

export interface KeysetPager<T> {
  page: number;          // zero-based
  pageRows: T[];         // the visible slice
  busy: boolean;         // isFetching || awaiting a fetch we asked for
  canFirst: boolean;
  canPrevious: boolean;
  canNext: boolean;
  first: () => void;
  previous: () => void;
  next: () => void;
}

export function useKeysetPager<T>(rows: T[], source: KeysetPagerSource): KeysetPager<T>;
```

- `next()` advances into cache when `rows.length > start + pageSize`; otherwise, if `hasNextPage`, sets the awaiting flag and calls `onLoadMore()`. The settle effect steps the page only once rows actually land, and gives up when the source reports `isFetching === false && hasNextPage === false` — carry that logic across unchanged, it is what stops the pager stranding.
- **`first()` jumps to page 0 over the cache with no refetch.** Every earlier page is already in the row model; re-fetching would burn a round trip on a connection that cannot spare one. This is the only jump a cursor can honestly offer, which is why there is no last/goto.
- `resetKey` change → page 0, awaiting cleared. Replaces the inlined `JSON.stringify([sortingState, filterValues])`; callers now pass what invalidates *their* page numbering (ticket 33 adds page size to it).

### `components/list-pager.tsx` — new file

Pure props, no TanStack, no react-query. Two honest modes, mirroring ADR-0003:

```ts
export type ListPagerProps =
  | {
      kind: "keyset";
      page: number;          // zero-based
      pageSize: number;
      busy?: boolean;
      canFirst: boolean;
      canPrevious: boolean;
      canNext: boolean;
      onFirst: () => void;
      onPrevious: () => void;
      onNext: () => void;
      /** Server-reported row count. With it the pager can say "Page N sur M". */
      total?: number;
      pageSizeOptions?: readonly number[];
      onPageSizeChange?: (size: number) => void;
      leading?: ReactNode;   // e.g. the selection count
    }
  | {
      kind: "counted";
      /* the fully-loaded mode: page, pageCount, first/prev/next/last, page size */
    };
```

Keyset rendering rules:

- **No last-page button and no arbitrary page jump.** ADR-0003 stands: a cursor does not know where the end is, and offset jumps skip and duplicate rows under concurrent writes. First/prev/next only.
- Without `total`: « Page N » (existing key `dataTable.page`).
- With `total`: « Page N sur M » where `M = Math.max(Math.ceil(total / pageSize), 1)` (existing key `dataTable.pageOf`), plus « X résultats » as a **new ICU plural key** (`dataTable.resultCount`) in fr+en.
- Knowing `total` does **not** unlock jumping — M is a display fact, not a navigable index. Say so in a comment; it is the obvious thing for a later reader to "fix".
- `onPageSizeChange` + `pageSizeOptions` render the rows-per-page `Select`; omitted, the control is absent. Reuse the existing `PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50]` (`data-table.tsx` ~line 85) — export it so ticket 33 and 34 import rather than redeclare.

### `DataTableFooter` becomes an adapter

It keeps its two-mode shape but delegates rendering to `ListPager`; `DataTable` feeds the keyset mode from `useKeysetPager` instead of its own inlined state, and passes the selection count through `leading`. `DataTableLoadMore` gains three optional fields — `total?: number`, `pageSizeOptions?: readonly number[]`, `onPageSizeChange?: (size: number) => void` — all optional, so every current caller (entries, approvals, periods, dashboard, `AssetRegisterScreen`) compiles untouched and renders exactly as before.

### i18n

New keys under `dataTable` in `apps/web/src/i18n/locales/fr.json` + `en.json` (`resultCount` as ICU plural, and whatever the first-page control needs beyond the existing `dataTable.firstPage`). `locales.test.ts` enforces fr/en key parity, no empty strings, and no `{{` interpolation.

## Tasks

- [ ] New `apps/web/src/hooks/useKeysetPager.ts` with the extracted logic; `DataTable` consumes it and drops its inlined keyset state.
- [ ] New `apps/web/src/components/list-pager.tsx`; export `PAGE_SIZE_OPTIONS` from wherever it now lives so other tickets import it.
- [ ] `DataTableFooter` rewritten as an adapter over `ListPager`; `DataTableLoadMore` gains `total`, `pageSizeOptions`, `onPageSizeChange` (all optional).
- [ ] i18n fr+en for the new keys; zero literals.
- [ ] Tests: a dedicated `list-pager.test.tsx` / `useKeysetPager.test.ts`, plus the existing `data-table.test.tsx` suite kept green unchanged.

## Acceptance

- [ ] Test: `useKeysetPager` walks forward by fetching when the cache is short and by slicing when it is not; walks backward over cache without fetching; `first()` returns to page 0 with **zero** `onLoadMore` calls.
- [ ] Test: `resetKey` change returns to page 0 and clears the awaiting state.
- [ ] Test: the pager does not strand when the server reports no next page mid-fetch (the settle-effect give-up path).
- [ ] Test: `ListPager` keyset mode renders no last-page control and no page-number input under any prop combination, including when `total` is supplied.
- [ ] Test: keyset with `total` renders « Page N sur M » and the result count; without `total`, « Page N » only.
- [ ] Test: `onPageSizeChange` fires with the chosen size; absent the handler, no rows-per-page control renders.
- [ ] Test: `DataTable` behaviour is byte-for-byte unchanged for a caller passing only today's `DataTableLoadMore` fields — the whole existing `data-table.test.tsx` suite passes without edits.
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green; all five current table screens compile untouched.

## Out of scope

Wiring any screen to the new props (33 finance, 34 assets), server `total` for entries or assets (30, 34), rows-per-page state on hooks (33), offset pagination of any kind.
