# 04 — record-revenue.v1 / record-expense.v1 handlers

**What to build:** The two entry-creating commands (one handler file, direction parameterized) with `approvalMode: 'SUBMIT'`, plus the shared helpers they introduce: `periods.ts` (resolution/auto-create per spec §Periods) and entry numbering via `number_counters`.

**Blocked by:** 03.

**Status:** ready-for-human

- [x] Handler registered for both commands, module FINANCE, roles FIELD_SUBMITTER|OPS_MANAGER|FINANCE_APPROVER|ADMIN, `approvalMode: 'SUBMIT'`
- [x] `approvalContext`: branchCode, categoryCode, amountMinor from payload
- [x] Reference validation: branch by code, category active + kind matches direction (CATEGORY_KIND_MISMATCH), posting assets exist in workspace and operational (multi-asset checked in handler; ASSET_NOT_OPERATIONAL)
- [x] Sum check: Σ postings == amountMinor else POSTINGS_SUM_MISMATCH (422)
- [x] AUTO_APPROVED → status POSTED, period resolved (auto-create OPEN; locked economic month → current month + is_late_posting + LATE_POSTING warning), posted_at set. APPROVAL_REQUIRED → status SUBMITTED, posting_period_id null
- [x] Entry number `{branchCode}-{year}-{seq5}` from `number_counters` (year of economic_date); concurrent-safe (row lock / upsert returning)
- [x] Evidence warning: RECEIPT_EXPECTED category + no artifacts + no paymentReference → EVIDENCE_MISSING
- [x] Postings rows written with indexing copies; audit event with full after_state
- [x] Tests (vitest integration, harness convention): below-threshold posts; above-threshold submits (command succeeds, recordStatus SUBMITTED); sum mismatch rejects atomically; late-posting path; numbering sequence; evidence warning; disposed-asset posting rejected; cross-tenant category/branch/asset invisible

## Comments

- Implemented 2026-07-23/24. record-expense.v1 shipped first with helpers (periods.ts, numbering.ts, branch-authorization.ts) + 12 integration tests; [codex] worker then refactored the handler into record-financial-entry.ts (direction-parameterized factory) registering record-revenue.v1, added its catalog defaults and 4 revenue tests; Fable reviewed (renamed factory to financialEntryCommand). 17 tests green across expense/revenue/registry, tsc clean.

