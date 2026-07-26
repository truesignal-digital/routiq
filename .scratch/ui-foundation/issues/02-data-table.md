# 02 — DataTable + entries/approvals migration

Status: ready-for-human
Blocked by: 01

Build `components/data-table.tsx` per spec § Design 2 (@tanstack/react-table pinned exact + shadcn table; column meta.mobile primary/secondary/hidden; card rendering below sm; loadMore footer for useInfiniteQuery; emptyState slot; onRowClick). Migrate FinanceEntriesScreen and FinanceApprovalsScreen onto it (desktop: columns for status/date/category/amount/counterparty…; mobile: cards equivalent to today's). Periods becomes a plain shadcn table. NO client-side sort/filter.

Acceptance:
- [x] jsdom tests: renders rows from fixture columns/data; loadMore button calls onLoadMore; empty state renders; mobile card branch renders primary fields (matchMedia mock)
- [x] Existing command-routing regression tests still green untouched
- [x] Web tests + typecheck green

## Comments

2026-07-26 [codex] clean first-round pass. DataTable per spec (meta.mobile card branch, loadMore, emptyState, keyboard-accessible row click), no client sort/filter models, @tanstack/react-table pinned 8.21.3. Entries + approvals migrated; periods on plain table. Command-routing regressions 2/2 intact. 132 web tests + typecheck green, Fable-verified.
