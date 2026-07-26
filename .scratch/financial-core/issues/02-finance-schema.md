# 02 — Finance schema + migration

**What to build:** `posting_periods`, `financial_entries`, `financial_postings`, `number_counters` tables in `schema.ts` (per spec §Entry & posting model / §Periods), plus `profitability_layer` and `evidence_policy` columns on `categories`. Migration adds M1 conventions for every new table: RLS + FORCE, composite tenant FKs, `routiq_app` grants — and the one period-lock trigger, `UPDATE`/`DELETE` revoked on `financial_postings`, `DELETE` revoked on `financial_entries`.

**Blocked by:** 01 (schema.ts churn ordering).

**Status:** ready-for-human

- [x] `posting_periods`: period_code 'YYYY-MM', status OPEN|LOCKED, locked_at, locked_by_command_id, row_version; unique (workspace_id, period_code)
- [x] `financial_entries` per spec: client id, entry_number unique per workspace, nullable posting_period_id until POSTED, status SUBMITTED|POSTED|REJECTED|REVERSED, unique reverses_entry_id, signed bigint amount
- [x] `financial_postings` per spec: (entry, line_no) unique, indexing copies (economic_date, posting_period_id, direction, category_id, branch_id), nullable asset_id composite FK, SIGNED amount, asset_attribution; NO activity/work-order/person columns
- [x] `number_counters`: PK (workspace_id, scope), next_value — for entry numbering
- [x] `categories`: profitability_layer (nullable enum; CHECK required when kind is REVENUE_CATEGORY/EXPENSE_CATEGORY), evidence_policy default RECEIPT_EXPECTED
- [x] Migration: RLS + FORCE + workspace policy on all new tables; composite tenant FKs (workspace_id, x_id) for entry→period/category/branch, posting→entry/asset/category/branch
- [x] Period-lock trigger: BEFORE INSERT/UPDATE on entries + postings, reject when posting_period_id is LOCKED
- [x] Grants: routiq_app gets table access per grants.test.ts convention; UPDATE/DELETE revoked on financial_postings (UPDATE re-granted on posting_period_id only, for approval-time assignment); DELETE revoked on financial_entries
- [x] `pnpm db:generate` output reconciled (0009 generated base DDL; 0010 hand-written custom); migration chain applies clean on fresh DB — verified: 19 tables from zero

## Comments

- Implemented 2026-07-23 by Fable (schema.ts + 0010 custom SQL by hand — worker migration draft skipped, security SQL kept in-session). Suite 93/93 incl. grants/rls convention guards; cold-start chain verified on a scratch database.
- Gotcha found: `categories_ws_id_uq` already existed from the documents migration — 0010 must not re-add it. drizzle-kit migrate reports failures without the failing statement; dry-run trick: pipe `BEGIN; <files>; ROLLBACK;` through psql with ON_ERROR_STOP.
- Added beyond spec: CHECK `financial_postings.amount_minor <> 0`; non-unique indexes on (ws, asset, economic_date) and (ws, posting_period) for the flagship queries.
- Deferral: postings UPDATE grant narrowed to `posting_period_id` column — revisit if approval flow ever needs to touch more (it shouldn't).
