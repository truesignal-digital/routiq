# 08 — Seeds, presets, smoke, convention updates

**What to build:** Wire the six commands into workspace defaults and the guard rails.

**Blocked by:** 04–07.

**Status:** ready-for-human

- [x] approval-defaults.ts: record-revenue/record-expense — FIELD_SUBMITTER, OPS_MANAGER, FINANCE_APPROVER, ADMIN each with amountMaxMinor 100_000 (all four needed: most-specific shadowing would strand FINANCE below threshold otherwise), plus FINANCE_APPROVER + ADMIN wildcards; approve/reject/reverse-entry + lock/reopen-period: FINANCE_APPROVER + ADMIN wildcards
- [x] category-presets.ts: revenue/expense categories for both templates carry profitability_layer (e.g. FUEL=DIRECT, REPAIRS=MAINTENANCE, INSURANCE=OWNERSHIP) and evidence_policy (PARKING/LOADING-style informal costs = NO_RECEIPT_EXPECTED per §5.4)
- [x] FINANCE module enabled wherever workspace seeding enables ASSETS/DOCUMENTS
- [x] registry.test.ts convention stays green for all six commands (catalog default present)
- [x] grants.test.ts green for new tables
- [x] smoke.ts extended: record expense below threshold → posted; above threshold → submitted → approved by second principal → posted; lock month; late expense → late-posts; reverse → nets to zero
- [x] Full suite + typecheck green

## Comments

- Implemented 2026-07-24 by [codex] worker, Fable reviewed. approval-defaults gained record-revenue band + wildcards for the five decision/period commands (done incrementally in 04-07); migration 0012_finance_command_defaults backfills the same rules idempotently for existing workspaces (0010 WHERE NOT EXISTS pattern; verified applied on dev DB — 6 rule sets present). category-presets already carried profitability_layer/evidence_policy from 02; FINANCE module is default-on, nothing to seed. smoke.ts extended with the finance flow (below-threshold post, submit→approve, reject, lock+late-post+reopen, reversal-nets-to-zero via bigint sum, record-revenue) — SMOKE OK.
- Final verification: workspace typecheck clean; full suite green — domain 3, contracts 53, web 68, api 131 (255 total).

