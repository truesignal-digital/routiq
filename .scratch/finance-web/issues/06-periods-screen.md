# 06 — Periods screen + lock/reopen

Status: ready-for-human
Blocked by: 02

**What to build:** Finance → Periods (FINANCE_APPROVER + ADMIN only) lists months newest first with status (Ouvert/Verrouillé), entry count, and lockedAt. Lock action on an OPEN (or absent — lock creates it) period: confirm dialog explaining the boundary ("les écritures de ce mois seront définitives"), fires `lock-period.v1`. Reopen on a LOCKED period requires a reason, fires `reopen-period.v1`.

## Constraints

- `PERIOD_HAS_SUBMITTED_ENTRIES` warning on lock renders the count/explanation: submitted entries will late-post on approval — warn, don't block, per §3.4.
- The current month may not exist yet (auto-created on first post): render it as an implicit OPEN row so the list never looks empty and locking it is possible.
- Period P&L numbers are NOT in scope — count only (reporting is a later spec).

## Files

- `apps/web/src/finance/usePeriods.ts`; `screens/FinancePeriodsScreen.tsx`; locale keys `finance.periods.*`.

## Acceptance

- [x] Lock and reopen payload mapping tests (reopen reason required)
- [x] Warning rendering on lock covered
- [x] Implicit current-month row logic tested (model test)
- [x] Role gating test; web tests + typecheck green

## Comments

2026-07-26 [codex] clean first-round pass. currentPeriodCode/mergeImplicitCurrentPeriod/validateReopenReason live in finance/model.ts and are imported by both screen and tests (13 new tests: merge absent/present/preserve, reason bounds incl trim, role gating incl module + undefined). PERIOD_HAS_SUBMITTED_ENTRIES notice rendered on lock; 24 fr/en keys at parity. 118 web tests + typecheck green, Fable-verified.

2026-07-26 CRITICAL POST-COMMIT BUG (Fable review of 07): one intentRef shared across both commands with an if-unset guard and no reset — after an approve, a reject submits through approve-entry.v1 (zod strips `reason`) and SILENTLY APPROVES the entry while showing the rejected message. Same shared-ref pattern in periods (fails loudly there). Missed in review because per-action payload tests never exercised sequential mixed actions. Fix + command-routing regression test dispatched; slice commit held until green.
