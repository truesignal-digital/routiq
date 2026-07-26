# 07 — lock-period.v1 / reopen-period.v1 handlers + trigger tests

**What to build:** The strict boundary. Lock is finance ceremony; reopen needs mandatory reason; the DB trigger is verified as backstop.

**Blocked by:** 03 (imports 04's periods helper).

**Status:** ready-for-human

- [x] Roles FINANCE_APPROVER|ADMIN both commands, module FINANCE, default approvalMode; catalog wildcard rules
- [x] Lock: period created-if-absent then OPEN → LOCKED (locking an untouched past month is legal); already-locked → INVALID_STATE_TRANSITION; locked_at + locked_by_command_id set
- [x] Lock warning: SUBMITTED entries with economic month in the period → PERIOD_HAS_SUBMITTED_ENTRIES warning, never a block
- [x] Reopen: LOCKED → OPEN else INVALID_STATE_TRANSITION; reason required in payload and recorded in the audit event; no bypass flag anywhere
- [x] `expectedVersion` required when the period row already exists (reopen always; lock when re-locking)
- [x] Trigger backstop test: direct SQL INSERT of a posting into a LOCKED period fails at the DB even though command layer would never do it
- [x] Tests: lock/reopen round-trip with audit reasons; record-expense into locked economic month auto-posts late to open month (end-to-end with 04); reopen then post targets reopened month normally

## Comments

- Implemented 2026-07-24 by [codex] worker (period-commands.ts + 7 integration tests incl. DB trigger backstop + end-to-end late-posting with lock ceremony). Fable review caught one spec gap: lock-period skipped checkOptimisticVersion when the period row already exists (auto-created by posting or reopened) — fixed, with EXPECTED_VERSION_REQUIRED/VERSION_CONFLICT coverage added to the trigger-backstop test. 7/7 green, tsc clean.

