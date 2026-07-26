# 02 — DataTable + entries/approvals migration

Status: ready-for-agent
Blocked by: 01

Build `components/data-table.tsx` per spec § Design 2 (@tanstack/react-table pinned exact + shadcn table; column meta.mobile primary/secondary/hidden; card rendering below sm; loadMore footer for useInfiniteQuery; emptyState slot; onRowClick). Migrate FinanceEntriesScreen and FinanceApprovalsScreen onto it (desktop: columns for status/date/category/amount/counterparty…; mobile: cards equivalent to today's). Periods becomes a plain shadcn table. NO client-side sort/filter.

Acceptance:
- [ ] jsdom tests: renders rows from fixture columns/data; loadMore button calls onLoadMore; empty state renders; mobile card branch renders primary fields (matchMedia mock)
- [ ] Existing command-routing regression tests still green untouched
- [ ] Web tests + typecheck green
