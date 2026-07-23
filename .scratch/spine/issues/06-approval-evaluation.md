# 06 — Approval-rule evaluation step

**What to build:** Every command passing through the pipeline is evaluated against tenant-editable approval rules before commit. When a rule says the actor's role suffices, the command proceeds; when no rule matches, the safe default applies — require review — and the command is rejected with a stable `APPROVAL_REQUIRED` code (the pending-approval flow itself ships with the financial-core spec, per the spine spec's approval decision; ARCHITECTURE.md §5.2).

**Blocked by:** 03 — Command pipeline core.

**Status:** ready-for-human

- [x] `approval_rules` table: command type, category, branch, amount range, required role — tenant-editable rows
- [x] Pipeline evaluation step before commit; handlers contain no approval logic
- [x] Safe default proven by test: command with no matching rule → `APPROVAL_REQUIRED`, nothing committed
- [x] Seed rules give spine commands their catalog defaults (§5.1): register/commission/assign auto for the asset-manager permission
- [x] Auto-approved outcome and matched rule recorded on the executed command receipt; would-require-approval remains an uncommitted rejection until the pending-approval flow lands

## Comments

- Implemented 2026-07-22. Category, branch, and amount filters are supported. The evaluator applies the most-specific matching rule set before checking the actor role, allowing tenant-specific rules to override broad seeded defaults. Tests cover auto-approval provenance, safe-default rollback, and override precedence.
- Fable review (2026-07-23): worker hit its session limit near the end; Fable added the missing test cases (amount-range filter; rejected command leaves its idempotency key free for the retry — proven with same key/commandId succeeding after a rule is added). Most-specific-decides semantics kept as an improvement over the original any-match spec: broad defaults would otherwise make stricter tenant rules unenforceable.
