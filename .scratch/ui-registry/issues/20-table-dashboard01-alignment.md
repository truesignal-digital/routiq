# 20 — Align DataTable with dashboard-01: sticky header, pager footer, row drawer

Status: ready-for-human
Phase: 4
Blocked by: —

**What to build:** Bring our DataTable v2 to the dashboard-01 block's table design (reviewed from the base-nova registry item 2026-07-27), and add its row-detail drawer pattern: click a row → side drawer (right on desktop, bottom on mobile) with details + a full-screen action opening the existing detail route. Foundation ticket — lands before 08/14/15.

## Design source (base-nova dashboard-01 data-table.tsx)

- Sticky table header: `sticky top-0 z-10 bg-muted`.
- Footer: selection count (left, hidden on mobile) · rows-per-page Select [10/20/30/40/50] (lg+) · "Page X of Y" · first/prev/next/last buttons (first/last lg+).
- Row viewer: vaul Drawer, `swipeDirection` right on desktop / down on mobile; header title+description, content, footer actions.
- DECISIONS: no @dnd-kit drag reorder (append-only ledger, no domain meaning); tabs stay screen-level (FinanceNav); drawer chart slot deferred to ticket 15.

## Tasks

- [ ] Vendor `drawer` via shadcn CLI (base-nova; brings `vaul` — PIN EXACT version in package.json per ARCHITECTURE.md §8). No @radix-ui. Register in registry.json.
- [ ] DataTable: sticky header styling per block.
- [ ] DataTable footer, two modes:
  - `pagination` mode (client-paginated, fully-loaded data): TanStack `getPaginationRowModel`, rows-per-page select, localized "Page X of Y" (ICU), first/prev/next/last with the block's responsive hiding. For screens like periods.
  - existing `loadMore` mode stays for keyset reads (entries/approvals) — do NOT fake page counts under keyset (ADR-0003 honesty rule).
  - Selection count stays in both modes.
- [ ] `rowViewer` prop on DataTable: `{ render: (row) => ReactNode, title/description accessors, fullScreen?: { label, onOpen(row) } }`. Row click opens the Drawer (right/desktop, bottom/mobile via the existing useDesktopMediaQuery or use-mobile hook); keyboard activation included; `onRowClick` remains for screens that want navigation instead — the two are mutually exclusive, typecheck-enforced.
- [ ] FinanceEntriesScreen adopts `rowViewer`: drawer shows the entry summary (reuse/extract the detail `<dl>` content from FinanceEntryDetailScreen into a shared `finance/EntrySummary.tsx` consuming the existing useEntry hook — loading/error states included), footer has "full screen" action navigating to /finance/entries/$entryId (existing route = full-screen mode). Approve/reject/reverse actions stay on the full screen for now.
- [ ] FinancePeriodsScreen switches to `pagination` footer mode (default 10 rows).
- [ ] i18n: all new strings fr+en, ICU only. Localize any hardcoded English the vendored drawer ships (dialog.tsx/sidebar.tsx precedent).
- [ ] Tests: sticky header class present; pagination mode pages client-side and hides under loadMore mode; drawer opens on row click and Escape/swipe-close works in jsdom (state-level assertions fine); full-screen action navigates; EntrySummary renders loading/error/data; mutual exclusivity type test via ts-expect-error.

## Acceptance

- [ ] `grep -rn "@radix-ui" apps/web pnpm-lock.yaml` returns nothing; vaul pinned exact
- [ ] Entries: row click opens side drawer with real entry data; full-screen opens the detail route
- [ ] Periods: full pager footer, rows-per-page functional
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green; jsdom command-routing tests green

## Out of scope

Drag reorder, drawer-embedded chart (15), editing inside the drawer, approvals drawer adoption (after this proves the pattern), tabs-in-table.

## Comments

- 2026-07-27 Opus worker: committed (ui-registry 20). base-nova drawer is Base UI-backed — no vaul, no new deps, nothing to localize. Exclusive prop unions (rowViewer⊕onRowClick, pagination⊕loadMore) typechecker-enforced via ts-expect-error. 488 tests. Open item folded into ticket 21: dashboard-01's bordered overflow-hidden table shell.
