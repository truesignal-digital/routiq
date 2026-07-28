# 25 — DataTable v3: primary column, row actions, keyset pager, server sort wiring

Status: ready-for-human
Phase: 5
Blocked by: —

**What to build:** (Linus 2026-07-27) The table basis: every table gets (a) a non-hidable descriptive primary column that is the ONLY click target for opening details, (b) a per-row actions menu, (c) pagination everywhere — keyset lists get a prev/next pager over cached pages, (d) server-sort wiring. Component layer only; screens adopt in ticket 26.

## Design

- **`primaryColumn`**: config `{ columnId }`. The column is forced `enableHiding: false` and always first among data columns; its cell renders as the drawer/detail trigger (link-styled button, underline on hover; aria-haspopup when drawer). **Row-wide onRowClick/rowViewer activation is REMOVED** — clicking anywhere else on the row does nothing (frees rows for action buttons; selection checkbox unaffected). rowViewer/onRowClick props keep their exclusivity but are triggered only via the primary cell.
- **`rowActions`**: `(row) => Array<{ key, label, icon?, onSelect(row), destructive? }>` rendered as the dashboard-01 ⋯ ellipsis DropdownMenu in a trailing non-hidable actions column. Empty array → no menu for that row. Role gating happens in the screen's config (it decides which actions to include per row) — the table never knows about roles.
- **Keyset pager**: under `loadMore`, replace the load-more button with the pager footer: prev/next buttons + localized "Page N" (no total, no first/last jump). Next = advance into cache or fetchNextPage; prev = walk cached pages back. Page size comes from the server limit. `pagination` mode (fully-loaded) keeps its full pager incl. first/last. One shared footer component, two honest modes.
- **Server sort**: when `sorting` is controlled (manualSorting), header sort toggles call `onSortingChange`; screens map it to the read's `sort` param and reset the cursor/page state (ticket 26). Component must reset its keyset page index when sorting or filters change.

## Tasks

- [ ] Implement the three features + pager rework in `src/components/data-table.tsx` (+ types tests for the new exclusivity/config invariants).
- [ ] Mobile card mode: primary cell is the card title and its tap target; ⋯ menu in the card corner; pager identical.
- [ ] i18n fr+en ICU (`dataTable.page` "Page {n}", `dataTable.actions`, prev/next labels). Zero literals.
- [ ] Also fix the SiteHeader stray vertical tick (Linus screenshot 2026-07-27): the separator between sidebar trigger and breadcrumb must be `h-4` self-centered, not overflowing the header row — match dashboard-01's SiteHeader exactly.
- [ ] Tests: primary column cannot be hidden via the view menu; only the primary cell opens the drawer (row-body click does nothing); actions menu renders per-row config and fires onSelect with the row; empty actions → no button; keyset pager walks forward (fetch) and backward (cache) with correct page number; page resets on filter/sort change; pagination mode unchanged incl. first/last; mobile card variants.

## Acceptance

- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green; existing consumers compile (screens adopt fully in 26 — interim compatibility shims acceptable if typed deprecated).

## Out of scope

Screen adoption (26), role model (future), assets card grid.

## Comments

- 2026-07-27 Opus worker: committed (ui-registry 25). primaryColumn is the opt-in switch — omitting it keeps deprecated whole-row activation so entries stays usable until 26 adopts everywhere. pageSize defaults from LIST_LIMIT_DEFAULT (contracts import). Forward paging steps only when rows land; page resets on sort/filter in both modes. SiteHeader tick = Separator data-vertical:self-stretch beaten with dashboard-01's self-auto h-4. 647 tests.
