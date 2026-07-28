# 10 — DataTable v2 (registry block)

Status: ready-for-agent
Phase: 2
Blocked by: 04, 05, 09

**What to build:** Grow `src/components/data-table.tsx` into the registry's table block: sorting, column visibility, row selection, a declarative filter toolbar, a row-count footer alongside the existing cursor load-more — keeping the mobile card mode and going fully localized.

## Context

Audit §2. The current component is 203 lines on TanStack Table v8 (`@tanstack/react-table` pinned at 8.21.3) with only `getCoreRowModel`. It already has: dual render (real `<Table>` ≥640px, stacked cards below) driven by `useDesktopMediaQuery` (`data-table.tsx:180`) and the module-augmented `ColumnMeta.mobile: "primary" | "secondary" | "hidden"` (`:25-29`); row click with Enter/Space keyboard support (`:169`); cursor load-more via the `loadMore` prop (`:154`); an `emptyState` prop that replaces the whole table when empty (`:57`). Absent: sorting, filtering, column visibility, row selection, pagination beyond load-more, per-column alignment, density.

Its only two consumers are `FinanceEntriesScreen.tsx:171` and `FinanceApprovalsScreen.tsx:247`, both building `ColumnDef[]` inline in a `useMemo` keyed on `[i18n.resolvedLanguage, t]`. Ticket 11 migrates them (and `FinancePeriodsScreen`) onto this API — design the props with those three screens in mind.

Shape reference: shadcn's `tasks` data-table example (toolbar + faceted filters + view-options dropdown + selection footer). Prefer its structure over inventing one. `dropdown-menu` and `checkbox` come from ticket 04; the debounce hook from ticket 09; formatting helpers from ticket 05.

**Filtering is server-side here.** Finance reads already accept real query params (`useEntries.ts:18-22` → `apps/api/src/reads/finance.ts:79-105`), so the toolbar must be a controlled surface that reports filter changes upward — it must not filter rows client-side.

## Tasks

- [ ] Sorting: `getSortedRowModel`, sortable header buttons with the stock icon affordance, per-column opt-in via `enableSorting`. Sorting state controlled-or-uncontrolled so a server-sorted screen can own it.
- [ ] Column visibility: a `dropdown-menu` "view" control toggling columns. Column display names come from a new `ColumnMeta.label` (extend the existing module augmentation at `:25-29`) — already-localized strings supplied by the screen.
- [ ] Row selection: `checkbox` select-all header cell and per-row cells behind an `enableRowSelection` prop; clicking a checkbox must not fire `onRowClick` (stop propagation), and keyboard row activation must still work.
- [ ] Declarative filter toolbar: a `filters?: DataTableFilter[]` prop where each entry is `{ columnId, type: "select", options: { value, label }[], placeholder }` or `{ columnId, type: "search", placeholder }`, plus controlled `filterValues` / `onFilterChange`. Search inputs debounce through ticket 09's hook; select filters apply immediately. A "clear filters" action appears only when a filter is set.
- [ ] Pagination: keep the cursor `loadMore` prop exactly as-is, and add a footer showing loaded row count (and selected count when selection is enabled), localized.
- [ ] Keep mobile card mode and `ColumnMeta.mobile` working, including with selection enabled (selection control lives in the card header).
- [ ] Fully localized: no literal strings in the component. New keys under `dataTable.*` in `fr.json` and `en.json` (fr-CM first), joining ticket 09's `dataTable.loadMore` / `dataTable.loading`.
- [ ] Register the block in `apps/web/registry.json` as a `registry:block` named `data-table` with its `registryDependencies` (`table`, `button`, `checkbox`, `dropdown-menu`, `input`, `select`) and npm dependency `@tanstack/react-table`.
- [ ] Extend `src/components/data-table.test.tsx`: sort toggles order; hiding a column removes its cells; select-all then per-row deselect reports the right selection and does not trigger `onRowClick`; a search filter emits one debounced `onFilterChange`; a select filter emits immediately; the footer count is localized; mobile mode still renders primary/secondary cells.

## Acceptance

- [ ] The component filters nothing itself — every filter change surfaces through `onFilterChange` (assert in a test that rows are unchanged until the parent supplies new data)
- [ ] `grep -n "\"[A-Z][a-z]" apps/web/src/components/data-table.tsx` shows no user-facing literal
- [ ] `registry.test.ts` green with the new block entry
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green
- [ ] jsdom command-routing regression tests stay green (`apps/web/src/commands/client.test.ts`)

## Out of scope

Migrating any screen (ticket 11), offset pagination (the read side is keyset — ADR in ticket 12), sticky first column, density switching, column resizing, CSV export, and virtualization. Do not bump `@tanstack/react-table` off 8.21.3 (pinned per ARCHITECTURE.md §8).

## Comments

- 2026-07-26 Opus worker: committed as 7539c3f. 21+3 tests. API: declarative filters (select/search), controlled filterValues/onFilterChange (never client-filters), sorting uncontrolled-or-manual, selection + mobile cards, ICU row counts, empty state keeps toolbar visible so clear-filters stays reachable. Deviations accepted: extra registry deps (lucide, react-i18next); lowercased key compare for grep hygiene. Found ticket 16 (ICU {{count}} bug) via probe test.
