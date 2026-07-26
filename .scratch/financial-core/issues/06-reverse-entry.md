# 06 — reverse-entry.v1 handler

**What to build:** Append-only correction: mirror entry with negated signed amounts; original flips POSTED → REVERSED and is never edited otherwise.

**Blocked by:** 03 (imports 04's periods + numbering helpers).

**Status:** ready-for-human

- [x] Roles FINANCE_APPROVER|ADMIN, module FINANCE, default approvalMode; catalog wildcard rules
- [x] `expectedVersion` required against the ORIGINAL entry
- [x] Original must be POSTED (INVALID_STATE_TRANSITION); not already reversed (ENTRY_ALREADY_REVERSED — also structurally backstopped by unique reverses_entry_id)
- [x] Reversal entry: client-generated reversalEntryId, same direction/category/branch/economic_date/counterparty, NEGATED amount_minor and posting amounts, `reverses_entry_id` set, new entry_number, status POSTED immediately, period resolved at execution (late-post rules apply)
- [x] Original: status → REVERSED, row_version bump, no other columns touched
- [x] Test: flagship §4.2 sum query over asset postings nets to zero after reversal (signed amounts proven)
- [x] Tests: happy path; double-reverse blocked; reversing SUBMITTED/REJECTED blocked; reversal after period lock late-posts; audit trail links both entries

## Comments

- Implemented 2026-07-24 by [codex] worker (reverse-entry.ts + 6 integration tests incl. the §4.2 signed-sum-nets-to-zero flagship), Fable reviewed (dropped a stray rejectedReason copy from the reversal insert). Two audit events link both entries (reversal_posted carries reason + postings; reversed carries reversedByEntryId). 14 tests green with decisions + registry regression, tsc clean.

