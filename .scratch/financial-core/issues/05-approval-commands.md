# 05 — approve-entry.v1 / reject-entry.v1 handlers

**What to build:** The decision commands. Finance role, single step, maker ≠ approver, optimistic concurrency required.

**Blocked by:** 03 (and 04's periods helper — coordinate import, don't duplicate).

**Status:** ready-for-human

- [x] Roles FINANCE_APPROVER|ADMIN, module FINANCE, default approvalMode (REJECT); catalog wildcard rules make them auto for those roles
- [x] `expectedVersion` required (EXPECTED_VERSION_REQUIRED / VERSION_CONFLICT via checkOptimisticVersion)
- [x] Entry must be SUBMITTED else INVALID_STATE_TRANSITION
- [x] Maker ≠ approver: approving principal ≠ initiated_by_principal_id of entry's created_by_command_id → else MAKER_CANNOT_APPROVE (403)
- [x] Approve: period resolution at approval time (late-post to open month if economic month locked, is_late_posting + LATE_POSTING warning), postings' posting_period_id updated, status POSTED, posted_at, row_version bump
- [x] Reject: status REJECTED, rejected_reason stored, postings untouched, no period assigned
- [x] Audit events carry before/after state
- [x] Tests: happy approve (period set on entry AND postings); maker-self-approve blocked; approve non-submitted blocked; reject stores reason; version conflict; approve after economic-month lock → late posting; rejected entries excluded from POSTED-filtered sums

## Comments

- Implemented 2026-07-24 by [codex] worker (entry-decisions.ts + 8 integration tests), Fable reviewed. Maker≠approver enforced on BOTH approve and reject; maker-self-approve test creates the SUBMITTED-by-approver state by deleting the tenant's wildcard rules (rules are tenant data). 20 tests green incl. record-expense + registry regression, tsc clean.

