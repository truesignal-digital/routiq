# 19 — Dashboard time-series read (chart data)

Status: ready-for-human
Phase: 4
Blocked by: —

**What to build:** Extend `GET /v1/dashboard` (ticket 17) with a posted-totals time series feeding the dashboard-01 area chart. Decided with Linus 2026-07-26 (supersedes the earlier no-chart triage answer).

## Context

Chart shape (dashboard-01 `ChartAreaInteractive`): daily series over a selectable range (90d default; the web UI offers 90/30/7). Two series: posted expense and posted revenue per day, workspace default currency, branch scope applied — same predicates as ticket 17's period totals (POSTED + REVERSED sum, signed postings, reversals net out; reuse the same helpers/constants — `LEDGER_ENTRY_STATUSES` in apps/api/src/reads/dashboard.ts).

Day bucketing on `economic_date` (the business date), not `posted_at` (audit timestamp) — the chart answers "what happened when", matching how period membership works.

## Tasks

- [ ] Extend `packages/contracts/src/reads/dashboard.ts`: `series: Array<{ date: ISO date, expenseMinor: number, revenueMinor: number }>` + a `days` query param (coerced int, 7..365, default 90) on the dashboard read's (currently empty) query schema. Zod 4 (`z.iso.date()`).
- [ ] `apps/api/src/reads/dashboard.ts`: one grouped query (`date_trunc`/`GROUP BY economic_date`) over the window `[today - days + 1, today]`, inside `inWorkspace` + branch scope, filtered to workspace default currency. Zero-fill missing days server-side so the chart never interpolates gaps — the response carries every day in the window.
- [ ] Tests: buckets match seeded fixtures; a reversal nets its day to zero; zero-fill produces exactly `days` entries; branch-scoped member sees narrowed sums; `days` out of bounds → 400 VALIDATION_FAILED.

## Acceptance

- [ ] `pnpm --filter @routiq/api test && pnpm --filter @routiq/contracts test && pnpm typecheck` green

## Out of scope

Web consumption (ticket 15), caching, non-default currencies, weekly/monthly bucketing (client can derive).

## Comments

- 2026-07-26 Opus worker: committed (see git log ui-registry 19). Workspace-timezone business days via new reads/business-date.ts (23:30 UTC = tomorrow in Douala, tested); zero-fill in route TS not SQL generate_series; series is REQUIRED on dashboardResponse — ticket 15 note. 228 api / 97 contracts tests green.
