# 02 — Approvals + periods reads

Status: ready-for-agent
Blocked by: —

**What to build:** Read views for the approvals inbox (ticket 05) and periods screen (ticket 06). Same pattern and file placement as ticket 01 (shares `packages/contracts/src/reads/finance.ts` and `apps/api/src/reads/finance.ts` — coordinate if run in parallel, or run after 01).

## Contracts

- `pendingApprovalItem`: entry list-item fields + `submittedByPrincipalId` and `submittedAt` (from the creating command receipt via `created_by_command_id` → `commands.initiated_by_principal_id` / timestamp). `rowVersion` is required — the client sends it as `expectedVersion` on approve/reject.
- `pendingApprovalsResponse`: `{ entries: [...], total: number }` (total for the nav badge; list capped at 100, oldest first — FIFO for the approver).
- `periodRead`: periodCode, status (OPEN|LOCKED), lockedAt (nullable), entryCount (entries posted to the period), rowVersion.
- `periodsResponse`: `{ periods: [...] }` ordered by periodCode desc.

## Routes

- `GET /v1/finance/approvals` — SUBMITTED entries in the caller's branch scope; join to `commands` for submitter principal + time.
- `GET /v1/finance/periods` — workspace periods with per-period entry count (posted entries only); periods are workspace-wide, no branch filter.

## Constraints

- Approvals route is data-only: it does NOT filter out the caller's own submissions — the client renders the maker-guard state, the command layer enforces `MAKER_CANNOT_APPROVE` (spec: maker guard rendering decision).
- Reuse `serializeMinor` from ticket 01.

## Acceptance

- [ ] Submitter principal resolves correctly through the command receipt join
- [ ] Scope test: branch-scoped approver sees only in-scope SUBMITTED entries; total matches
- [ ] Periods: auto-created period appears with count; locked period carries lockedAt
- [ ] Contracts exported + parse tests; vitest + typecheck green
