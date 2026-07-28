# 17 — /v1/dashboard aggregate read

Status: ready-for-agent
Phase: 4
Blocked by: —

**What to build:** One read endpoint powering the dashboard KPI cards with honest numbers (ticket 15 triage, decided 2026-07-26): asset counts by lifecycle status, current-open-period posted totals, pending-approvals count.

## Context

CQRS-lite (ADR-0003, ARCHITECTURE.md §5): reads are plain SQL views over the write model — aggregates computed per request, no projections, nothing to rebuild. This endpoint exists because list reads are keyset-paginated, so client-side counting is page-scoped and lies once data passes one page (see ticket 13 comments re assets hero metrics).

Shape (single GET /v1/dashboard, auth-scoped like every read — workspace from auth, branch scope applied):

```
{
  assets: { total, byStatus: { REGISTERED, IN_SERVICE, UNDER_MAINTENANCE, SOLD, RETIRED, WRITTEN_OFF } },
  openPeriod: { periodCode, postedExpenseMinor, postedRevenueMinor, currency } | null,
  pendingApprovals: { count }
}
```

Money as string-serialized bigint minor units (see serialize-minor.ts usage in reads/finance.ts). XAF exponent 0.

## Tasks

- [ ] Zod response schema in `packages/contracts/src/reads/dashboard.ts` + test; re-export from index.
- [ ] `apps/api/src/reads/dashboard.ts` — three aggregate queries inside `inWorkspace`, branch scope applied to assets and entries the same way the list reads do; posted totals = SIGNED sums over postings of POSTED entries in the open period (reversals subtract — invariant §3.4); pendingApprovals matches the approvals read's queue definition exactly (same predicate, or the two numbers will disagree on screen).
- [ ] Register route; API tests: counts match seeded fixtures; branch-scoped member sees narrowed counts; reversal subtracts from totals; empty workspace → zeros/null openPeriod.

## Acceptance

- [ ] `pnpm --filter @routiq/api test && pnpm --filter @routiq/contracts test && pnpm typecheck` green
- [ ] Numbers provably consistent with the approvals read's total (shared predicate asserted in a test)

## Out of scope

Time-series (chart deferred), caching, web consumption (ticket 15).

## Comments

- 2026-07-26 Opus worker: committed as d573c31. Deviations accepted on review: money as numbers via serializeMinor (ticket text said strings — wrong, sibling reads use numbers); totals sum POSTED+REVERSED so reversals net to zero (summing POSTED alone reports phantom loss — reversal test proves it); open period = highest OPEN code; totals filtered to workspace default currency. Shared pendingApprovalConditions helper in reads/approvals-queue.ts — dashboard count === approvals total asserted across three scope levels.
