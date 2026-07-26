# 06 — Periods screen + lock/reopen

Status: ready-for-agent
Blocked by: 02

**What to build:** Finance → Periods (FINANCE_APPROVER + ADMIN only) lists months newest first with status (Ouvert/Verrouillé), entry count, and lockedAt. Lock action on an OPEN (or absent — lock creates it) period: confirm dialog explaining the boundary ("les écritures de ce mois seront définitives"), fires `lock-period.v1`. Reopen on a LOCKED period requires a reason, fires `reopen-period.v1`.

## Constraints

- `PERIOD_HAS_SUBMITTED_ENTRIES` warning on lock renders the count/explanation: submitted entries will late-post on approval — warn, don't block, per §3.4.
- The current month may not exist yet (auto-created on first post): render it as an implicit OPEN row so the list never looks empty and locking it is possible.
- Period P&L numbers are NOT in scope — count only (reporting is a later spec).

## Files

- `apps/web/src/finance/usePeriods.ts`; `screens/FinancePeriodsScreen.tsx`; locale keys `finance.periods.*`.

## Acceptance

- [ ] Lock and reopen payload mapping tests (reopen reason required)
- [ ] Warning rendering on lock covered
- [ ] Implicit current-month row logic tested (model test)
- [ ] Role gating test; web tests + typecheck green
