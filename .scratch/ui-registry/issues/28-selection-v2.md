# 28 — DataTable selection v2: per-row gating, page-scoped select-all, selection toolbar

Status: ready-for-agent
Phase: 6
Blocked by: —

**What to build:** Selection checkboxes exist (ticket 24) but nothing can use them: every row is selectable whether or not the operator may act on it, select-all silently spans every page fetched so far, and there is nowhere to put a bulk action button. Close all three gaps in `apps/web/src/components/data-table.tsx`, and extract a standalone `apps/web/src/components/selection-bar.tsx` that ticket 35's asset **card grid** can reuse (it is not a DataTable).

## Design

### `getRowCanSelect` — exclude rows the operator cannot act on

```ts
/** Rows this operator may not act on (maker guard, terminal status) get a
 *  disabled checkbox and are skipped by select-all. */
getRowCanSelect?: (row: TData) => boolean;
```

The table already renders `disabled={!row.getCanSelect()}` on the row checkbox (`data-table.tsx` ~line 366) — but `getCanSelect()` is never configured, so it is unconditionally `true`. TanStack's `enableRowSelection` option accepts `boolean | ((row: Row<TData>) => boolean)`; it is currently passed the plain boolean (~line 398). Pass a function when `getRowCanSelect` is supplied:

```ts
enableRowSelection: enableRowSelection
  ? getRowCanSelect
    ? (row) => getRowCanSelect(row.original)
    : true
  : false,
```

Screens decide the predicate — the table never learns about roles, exactly as `rowActions` was kept role-blind in ticket 25.

### Select-all becomes page-scoped

Today the header checkbox reads `table.getIsAllRowsSelected()` / `getIsSomeRowsSelected()` and toggles all rows (~lines 353-360). Under a keyset cursor the row model holds **every page fetched so far**, so "tout sélectionner" on page 3 quietly selects 150 rows the operator never looked at, and then bulk-approves them. It must scope to the **visible slice** — the same `rows` array computed at `data-table.tsx` ~line 517 (`modelRows.slice(keysetStart, keysetStart + keysetPageSize)` under `loadMore`, `modelRows` otherwise).

- Checked when every *selectable* visible row is selected; indeterminate when some are.
- Toggling selects/deselects only the visible selectable rows; rows failing `getRowCanSelect` are skipped in both directions.
- A page with zero selectable rows renders the header checkbox disabled.
- **Selection persists across pages** — walking to page 2 and back keeps page 1's picks (TanStack's `rowSelection` state is already keyed by row id via `getRowId`; do not clear it on page change). The count shown is the total across pages, which is why the bar says "n sélectionnées" and not "n sur cette page".

This also caps batch size at one page, which is the mitigation for long batches on 2G — a deliberate side effect, not an accident.

### `selectionToolbar` — the slot that was missing

```ts
selectionToolbar?: (ctx: {
  selectedRows: TData[];
  clearSelection: () => void;
}) => ReactNode;
```

`selectedRows` is `table.getSelectedRowModel().rows.map((r) => r.original)` — the **full** selection across pages, not the visible slice. When `selectedRows.length > 0`, the toolbar row (`data-table.tsx` ~lines 459-499: filters + clear-filters + view menu) is **replaced** by the `SelectionBar`; at zero it returns to the filter row. Follow the dashboard-01 pattern already used elsewhere in this repo: a single row swapping content, not a second row appearing and shoving the table down.

Mobile card mode gets the same treatment — the bar sits above the card list, the per-card checkbox honours `getRowCanSelect`.

### `SelectionBar` — standalone, reusable

New file `apps/web/src/components/selection-bar.tsx`, pure props, no TanStack import (ticket 35 mounts it over a card grid):

```ts
export function SelectionBar({
  count,
  onClear,
  children,        // the action buttons, supplied by the screen
  className,
}: {
  count: number;
  onClear: () => void;
  children?: ReactNode;
  className?: string;
}): ReactNode;
```

Renders the ICU count (`dataTable.selectedCount` already exists in both catalogs: `"{count, plural, one {# ligne sélectionnée} other {# lignes sélectionnées}}"`), a « Effacer » clear button, then `children` aligned to the trailing edge. `DataTable` composes it; it does not inline the markup.

### i18n

`apps/web/src/i18n/locales/fr.json` + `en.json`, under `dataTable`. Reuse `selectedCount`; add only what is new (e.g. `clearSelection`). ICU plurals only — `apps/web/src/i18n/locales.test.ts` fails the build on `{{`-style interpolation, on a key present in one catalog and not the other, and on any empty string. Zero literal strings in the components.

## Tasks

- [ ] `getRowCanSelect` prop wired into TanStack `enableRowSelection` as a function; checkbox `disabled` state follows it (the existing `!row.getCanSelect()` binding starts working for free).
- [ ] Page-scoped select-all in both the desktop header cell and the mobile card list, skipping unselectable rows in both directions; header checkbox disabled when the page has none.
- [ ] Selection survives paging both ways (no clearing in the page-change effects) — note it explicitly next to the existing page-reset effect at `data-table.tsx` ~line 425 so a future edit does not undo it.
- [ ] New `apps/web/src/components/selection-bar.tsx` per the signature above.
- [ ] `selectionToolbar` prop; the bar replaces the filter/view-menu row while `selectedRows.length > 0`, restores it at zero. Mobile parity.
- [ ] i18n fr+en for any new key; no literals.
- [ ] Tests in `apps/web/src/components/data-table.test.tsx` (+ a `selection-bar` test if the bar carries logic worth pinning).

## Acceptance

- [ ] Test: rows failing `getRowCanSelect` render a disabled checkbox and cannot be selected by clicking or by select-all.
- [ ] Test: select-all on a table holding 3 fetched pages selects only the visible page's selectable rows, and the count reflects that — the regression this ticket exists to prevent.
- [ ] Test: select rows on page 1, page forward and back, selection is intact and the bar count is the cross-page total.
- [ ] Test: header checkbox is indeterminate with a partial page selection, checked when all selectable visible rows are picked, disabled when none are selectable.
- [ ] Test: `selectionToolbar` renders inside the bar, receives the full cross-page `selectedRows`, and `clearSelection()` empties the selection and restores the filter row.
- [ ] Test: with `selectionToolbar` unset, behaviour is unchanged from today (no bar, filter row always visible).
- [ ] Test: mobile card mode mirrors gating, page-scoped select-all, and the bar.
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green; existing table consumers (entries, approvals, periods, dashboard) compile and their tests stay green.

## Out of scope

The pager rework (ticket 29 — same file, strictly after this one, same agent), any bulk command execution (27), screen adoption (32, 35), asset card-grid selection UI (35 consumes `SelectionBar`, it does not land here).
