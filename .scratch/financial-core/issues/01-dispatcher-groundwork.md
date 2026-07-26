# 01 — Dispatcher groundwork: submit-mode approvals + REJECTED/FAILED receipts

**What to build:** Two dispatcher-level changes every finance command depends on. (a) `evaluateApproval` returns its decision instead of throwing; commands may opt in to `approvalMode: 'SUBMIT'` and receive the decision in `execute` — default stays reject-with-403. (b) Failed commands leave a receipt: `commands_ws_idem_uq` becomes partial (`WHERE status = 'EXECUTED'`), and after rollback the dispatcher records a REJECTED (CommandError) or FAILED (unexpected) row with server-generated id + `client_command_id`, in its own transaction. Idempotency key is only consumed by success.

**Blocked by:** —

**Status:** ready-for-human

- [x] `evaluateApproval` returns `{outcome: 'AUTO_APPROVED' | 'APPROVAL_REQUIRED', ruleId}`; no throw
- [x] `CommandDefinition.approvalMode?: 'REJECT' | 'SUBMIT'` (default REJECT keeps today's 403 for all existing commands — proven by existing tests staying green)
- [x] SUBMIT mode: dispatcher proceeds and passes the decision to `execute` as 5th param; receipt row records `approvalOutcome`/`approvalRuleId` in both modes
- [x] `execute` may return `recordStatus`; `CommandOutcome`/`StoredCommandOutcome` carry it (optional), replay preserves it
- [x] Migration: partial unique index on `(workspace_id, idempotency_key) WHERE status = 'EXECUTED'` (0008); new nullable `client_command_id` column
- [x] `findReceipt` filters `status = 'EXECUTED'`
- [x] REJECTED receipt written after rollback for CommandError raised after envelope parse; FAILED for unexpected errors; stores failure_code, payload, origin, principal, idempotency key; own short transaction with RLS `set_config`
- [x] No receipt for outer VALIDATION_FAILED (no envelope) or auth failures
- [x] Tests: rejected command writes REJECTED receipt AND same key+commandId succeeds afterward once blocker removed; multiple REJECTED rows per key allowed; replay of EXECUTED unaffected

## Comments

- Implemented 2026-07-23. Fable did dispatcher/approvals/schema; [codex] worker wrote `receipts.test.ts` (6 integration tests, reviewed — assertions query the commands table directly, no weakening found). Suite 93/93.
- Deferrals: no test provokes a FAILED (5xx) receipt — needs a deliberately-broken command definition; revisit if a natural 500 path appears. Receipt-write-failure-doesn't-mask-error is code-guarded (try/catch + log) but untested for the same reason.
- Note: `execute`'s 5th param means SUBMIT-mode handlers see the approval decision; REJECT-mode handlers never reach execute on APPROVAL_REQUIRED, unchanged.
