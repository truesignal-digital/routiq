# 15 — Dashboard-01 home (full block)

Status: ready-for-human
Phase: 4
Blocked by: 17, 18, 19

**What to build:** The ROUTIQ home as the full shadcn dashboard-01 composition inside the new shell (ticket 18): SectionCards KPI row, ChartAreaInteractive (recharts), recent-entries DataTable v2. Registered as registry:block `dashboard-home`. Becomes the landing route.

## Context

Reference: shadcn block dashboard-01. Data: `GET /v1/dashboard` (tickets 17+19) — KPIs (pendingApprovals, assets byStatus, openPeriod totals) and the daily series. Recent entries: existing entries read, first page, no filters.

Decisions (triage 2026-07-26, revised same day): app-wide shell (18); chart IN with recharts; one shared layout, permission-gated cards (module/role via visibleSections logic); page-scoped counting is banned — every number comes from the aggregate read.

## Tasks

- [ ] Vendor `chart` via shadcn CLI (base-nova); pin recharts EXACT version in package.json (ARCHITECTURE.md §8); register in registry.json. No @radix-ui.
- [ ] `src/screens/DashboardScreen.tsx` composed of:
  - `SectionCards`: KPI cards on vendored Card — pending approvals (links to approvals), assets in service / total (links to assets), open-period expense + revenue (links to entries). Money via formatMoney; skeletons + ErrorBanner states; cards permission-gated like nav sections.
  - `ChartAreaInteractive`: area chart of the 17/19 series, 90/30/7 range toggle (stock Tabs), fr/en localized axes via formatDate, currency tooltip via formatMoney. Renders nothing (reserved slot with EmptyState) when the series is all zeros.
  - Recent entries: DataTable v2, first page, entryNumber/status/date/category/amount columns reused from FinanceEntriesScreen's defs where practical, row click → detail.
- [ ] `useDashboard` hook (TanStack Query, ws-scoped key, fetchImpl injectable) parsing the contracts schema.
- [ ] Route `/` renders it (update router default + sections.ts so the sidebar highlights Home); keep deep links working.
- [ ] Register `dashboard-home` as registry:block with registryDependencies (card, chart, tabs, data-table, page-container).
- [ ] i18n fr/en, ICU only. Tests: KPI loading/error/permission-gated states; chart range toggle refetches with days param; recent table renders + row-click navigates; no hardcoded English.

## Acceptance

- [ ] Landing on / as each smoke role shows honest numbers matching the API (no client-side counting anywhere on the screen)
- [ ] `grep -rn "@radix-ui" apps/web pnpm-lock.yaml` returns nothing
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green; jsdom command-routing tests green

## Out of scope

Per-asset drill-down charts, export, dark mode, AI insights (§7).

## Comments` before implementation starts
- [ ] `grep -rn "@radix-ui" apps/web pnpm-lock.yaml` returns nothing
- [ ] All copy localized with fr/en parity; all money and dates via `src/lib/format.ts`
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green
- [ ] jsdom command-routing regression tests stay green (`apps/web/src/commands/client.test.ts`)

## Out of scope

New aggregate read endpoints unless triage explicitly adds one, dark mode, a theme toggle, replacing the mobile bottom nav, and any AI/insight surface (ARCHITECTURE.md §7 — AI lands later as a restricted principal on the same commands).

## Comments

- 2026-07-26 triage with Linus (decisions final):
  1. KPIs: pending approvals, assets by status, current-period posted totals. Honest numbers via ticket 17's /v1/dashboard aggregate read (this ticket is blocked by it).
  2. No chart in v1 — no recharts dep; KPI cards + recent-entries DataTable v2 only.
  3. Keep AppShell — do NOT vendor shadcn sidebar; dashboard is a screen inside the existing shell.
  4. One shared layout, permission-gated cards (same visibleSections/module logic as nav) — not per-role homes.
  Sidebar/chart vendoring tasks in the body are superseded accordingly.
- 2026-07-27 Opus worker: committed (ui-registry 15). recharts 3.8.0 exact — NOTE: pulls @reduxjs/toolkit + d3-* transitively (bundle-size fact for low-end Android; accepted with the chart decision). Executive-viewer keeps totals, no entries link (signed off). Shared useFinanceEntryColumns prevents chip/amount drift between home and entries. Follow-ups filed separately: DataTable maxHeight for true sticky header; finance back-buttons → /. 598 tests.
