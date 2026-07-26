# Spec: Financial Core — Entries, Postings, Approval Flow, Period Locks

Status: ready-for-human
Source: ARCHITECTURE.md v0.2 (§4.2, §4.3, §5.1, §5.2, §5.4); spine spec `.scratch/spine/` (approval flow deferred to here); decisions locked with Linus 2026-07-23.

## Problem Statement

The spine can register assets and documents, but the platform's actual product — trustworthy money records per asset — has no home. Revenue and expenses cannot be recorded; the approval model shipped as a binary gate (authorized → executed, otherwise 403 `APPROVAL_REQUIRED`), so any command above threshold simply dies instead of waiting for a decision; there is no period boundary, so history is never final; and failed commands leave no receipt, so offline replay debugging is blind. This spec builds the financial core: the entry+postings model §4.2 calls "the part that must be right."

## Solution

Financial entries with signed postings, flowing through the existing command pipeline, gaining the first real approval lifecycle:

- `record-revenue.v1` / `record-expense.v1` create an entry with its postings. Below the approval threshold it lands `POSTED` immediately; above it (or with no matching rule) it lands `SUBMITTED` — the command **succeeds** and the record waits.
- `approve-entry.v1` / `reject-entry.v1` are the decision commands (finance role, maker ≠ approver, single step per §5.2).
- `reverse-entry.v1` implements append-only correction: a mirror entry with negated signed amounts; the original is never edited.
- `lock-period.v1` / `reopen-period.v1` manage monthly posting periods — the strict boundary. Periods auto-create `OPEN` on first post; locking is the ceremony, opening is not.
- The dispatcher additionally records `REJECTED`/`FAILED` command receipts (folded-in parked item) without consuming the idempotency key.

Reads (`GET` views for entries, pending approvals, period status) are the UI session's territory (`apps/api/src/reads/`) — this spec delivers schema + commands and hands the read contract over.

## Locked decisions (Linus, 2026-07-23)

1. Submitted-state scope: **financial entries only** this cycle. `DisposeAsset`, module toggles, and other always-approval commands keep the current 403 behavior until their own specs migrate them.
2. Payload carries a **postings array** (single line typical); amounts must sum to the entry. No flat single-line convenience shape.
3. Periods **auto-create OPEN on first post** (calendar month, workspace timezone). No period-admin ceremony. `LockPeriod` locks, `ReopenPeriod` needs reason + finance role.
4. Approval rules semantics stay **most-specific-shadows-defaults** as shipped. `/health` keeps its DB roundtrip.
5. Folded-in parked item: **REJECTED/FAILED receipts**. App-as-runtime-role auth path stays parked.

## Implementation Decisions

### Entry & posting model (§4.2)

- `financial_entries`: client-generated `id`; `entry_number` server-assigned (`{branchCode}-{year}-{seq5}`, per-branch-per-year counter, year from `economic_date`); `direction` REVENUE|EXPENSE; `category_id`; `economic_date`; `posting_period_id` **nullable until POSTED**; `is_late_posting`; `branch_id`; `counterparty_name` text (counterparty entity deferred); `description`; `amount_minor` bigint signed; `currency` default XAF; `payment_method` CASH|MOMO|OM|BANK|OTHER; `payment_reference`; `source_reference`; `estimate_status` ACTUAL|ESTIMATED; `status` **SUBMITTED|POSTED|REJECTED|REVERSED** (DRAFT is a client-side concept — the server never stores drafts); `rejected_reason`; `reverses_entry_id` self-reference (unique — an entry is reversed at most once); `posted_at`; `row_version`; `created_by_command_id`. Unique `(workspace_id, entry_number)`.
- `financial_postings`: server id; `financial_entry_id` + `line_no` (unique pair); copies of `economic_date`, `posting_period_id`, `direction`, `category_id`, `branch_id` for query indexing; `asset_id` nullable with composite tenant FK; `amount_minor` bigint **SIGNED** (reversals negative); `asset_attribution` DIRECT|ALLOCATED default DIRECT. **`activity_id`, `work_order_id`, `person_id` columns are deferred** to the activities/maintenance/compensation specs — column adds are additive.
- Sum invariant: `Σ postings.amount_minor == entry.amount_minor`, enforced in the command layer (`POSTINGS_SUM_MISMATCH`), proven by test. No DB trigger for it (§4.3: cheap structural backstops only).
- Postings are immutable: no UPDATE path in code, `UPDATE`/`DELETE` revoked from `routiq_app` on `financial_postings`; `DELETE` revoked on `financial_entries` (entries need UPDATE for status transitions only).
- Categories gain `profitability_layer` (DIRECT|MAINTENANCE|OWNERSHIP|SHARED, required for REVENUE_CATEGORY/EXPENSE_CATEGORY kinds) and `evidence_policy` (RECEIPT_EXPECTED|NO_RECEIPT_EXPECTED, default RECEIPT_EXPECTED). Template presets updated accordingly.
- Entry commands validate: category exists, active, right kind for direction (`CATEGORY_KIND_MISMATCH`); referenced assets exist in workspace and are operational (multi-asset postings checked in the handler; the dispatcher `operationalAssetId` hook only covers single-target commands).
- Evidence policy (§5.4): RECEIPT_EXPECTED category + no `sourceArtifactIds` + no `payment_reference` → warning `EVIDENCE_MISSING` on the outcome. Warn, don't block.

### Approval lifecycle (§5.2)

- `evaluateApproval` is refactored to **return** `{outcome: 'AUTO_APPROVED' | 'APPROVAL_REQUIRED', ruleId}` instead of throwing. `CommandDefinition` gains `approvalMode?: 'REJECT' | 'SUBMIT'` (default `'REJECT'` = today's 403). For `SUBMIT` commands the dispatcher passes the decision to `execute` as a 5th parameter; the handler stores `SUBMITTED` or `POSTED`.
- `execute` may return optional `recordStatus`; `CommandOutcome`/`StoredCommandOutcome` carry it so clients (and offline replay) see POSTED vs SUBMITTED.
- `approve-entry.v1` (payload: entryId, note?) and `reject-entry.v1` (payload: entryId, reason required): allowedRoles FINANCE_APPROVER + ADMIN, `expectedVersion` required, entry must be SUBMITTED (`INVALID_STATE_TRANSITION` otherwise). **Maker ≠ approver**: the approving principal must differ from `initiated_by_principal_id` of the entry's creating command (`MAKER_CANNOT_APPROVE`). Who-may-approve stays role-based this cycle; rule-driven approver resolution is deferred.
- `reverse-entry.v1` (payload: reversalEntryId client-generated, originalEntryId, reason required): original must be POSTED and not already reversed (`ENTRY_ALREADY_REVERSED`); creates a mirror entry — same direction/category/branch/economic_date, **negated** `amount_minor` and posting amounts, `reverses_entry_id` set — posted immediately (roles FINANCE_APPROVER + ADMIN, "same or stricter than original" satisfied by role restriction). Original flips POSTED → REVERSED (row_version bump; no other field edits).

### Periods (§4.3)

- `posting_periods`: `period_code` 'YYYY-MM', status OPEN|LOCKED, `locked_at`, `locked_by_command_id`, `row_version`. Unique `(workspace_id, period_code)`.
- Resolution at POST time (auto-approve, approve, reverse): compute `period_code` from `economic_date` in the workspace timezone. If that period is absent → create OPEN and post to it. If LOCKED → post to the current calendar month's period instead (auto-create), set `is_late_posting = true`, warning `LATE_POSTING`. Posting period may differ from economic month for that reason only; period P&L uses posting period, activity views use economic date.
- `lock-period.v1` (payload: periodCode): FINANCE_APPROVER + ADMIN. Creates-if-absent then OPEN → LOCKED. SUBMITTED entries whose economic month falls in the period do **not** block — warning `PERIOD_HAS_SUBMITTED_ENTRIES`; they will late-post on approval.
- `reopen-period.v1` (payload: periodCode, reason required): FINANCE_APPROVER + ADMIN, LOCKED → OPEN (`INVALID_STATE_TRANSITION` if not locked), reason lands in the audit event. No admin bypass flag exists.
- **One period-lock trigger** (the only financial trigger): BEFORE INSERT/UPDATE on `financial_entries`/`financial_postings`, reject rows referencing a LOCKED `posting_period_id`. Pure backstop — command-layer resolution never targets a locked period.

### REJECTED/FAILED receipts (folded-in parked item)

- `commands_ws_idem_uq` becomes a **partial unique index `WHERE status = 'EXECUTED'`**; `findReceipt` filters `status = 'EXECUTED'`. The idempotency key is only consumed by success — a rejected command may be retried with the same key/commandId after the blocker is fixed (offline-replay requirement; already asserted by a spine test).
- On `CommandError` after envelope parse (and on unexpected failure), the dispatcher writes a receipt **after rollback, in its own short transaction**: server-generated `id`, new nullable column `client_command_id` = envelope.commandId, status REJECTED (CommandError) or FAILED (unexpected), `failure_code`, payload, origin, principal, idempotency key. Multiple rejection rows per key are allowed and are the offline debugging trail. Errors before envelope parse (outer VALIDATION_FAILED, auth) write nothing. Rejected receipts never participate in idempotency replay — a retry re-evaluates against current state.

### Wiring

- New module code `FINANCE` in `MODULE_CODES`; all six commands belong to it; enabled by default wherever existing seeding enables ASSETS/DOCUMENTS.
- Catalog approval defaults (registry.test.ts convention): record-revenue/record-expense — all four writing roles (FIELD_SUBMITTER, OPS_MANAGER, FINANCE_APPROVER, ADMIN) with `amountMaxMinor = 100_000` (pilot placeholder threshold, tenant-editable; §12 Q1 will calibrate), plus FINANCE_APPROVER and ADMIN wildcard rules for above-threshold auto-post. The four-role band is required so most-specific-shadows-defaults doesn't strand FINANCE_APPROVER below threshold. approve/reject/reverse-entry: FINANCE_APPROVER + ADMIN wildcard. lock-period/reopen-period: FINANCE_APPROVER + ADMIN wildcard.
- `approvalContext` for record commands: branchCode, categoryCode, amountMinor from payload.
- New error codes: `POSTINGS_SUM_MISMATCH`, `MAKER_CANNOT_APPROVE`, `ENTRY_ALREADY_REVERSED`, `PERIOD_LOCKED`, `CATEGORY_KIND_MISMATCH`. New stable warning codes (outcome `warnings`): `EVIDENCE_MISSING`, `LATE_POSTING`, `PERIOD_HAS_SUBMITTED_ENTRIES`.
- New tables follow M1 conventions: RLS + FORCE, composite tenant FKs, `routiq_app` grants in the migration (db/grants.test.ts enforces), `SET LOCAL app.workspace_id` untouched.
- Money: `moneyMinor` from contracts; XAF exponent 0 — never divide by 100. Client payload amounts positive integers; the server signs reversal rows.

## Deferred (record in ticket Comments, do not build)

- Counterparty entity (text field for now); `activity_id`/`work_order_id`/`person_id` posting dimensions; rule-driven approver resolution; submitted-state for non-financial commands; stock ledger; CSV backfill mode; notifications on approval-requested (table lands with the notifications spec); fuzzy duplicate warning (§5.3) — revisit with offline spec.

## Tickets

| # | Ticket | Owner | Blocked by |
|---|---|---|---|
| 01 | Dispatcher groundwork: submit-mode approvals + REJECTED/FAILED receipts | Fable (shared files) + worker tests | — |
| 02 | Finance schema + migration (tables, category columns, RLS/FKs/trigger/grants) | Fable schema.ts, worker migration draft | 01 |
| 03 | Finance contracts: payload schemas, errors, module code | worker, Fable review | 02 |
| 04 | record-revenue / record-expense handlers (+ periods & numbering helpers) | worker | 03 |
| 05 | approve-entry / reject-entry handlers | worker | 03 |
| 06 | reverse-entry handler | worker | 03 |
| 07 | lock-period / reopen-period handlers + trigger & late-posting tests | worker | 03 |
| 08 | Seeds, presets, smoke script, registry-convention updates | worker | 04–07 |
