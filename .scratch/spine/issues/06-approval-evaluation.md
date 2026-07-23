# 06 — Approval-rule evaluation step

**What to build:** Every command passing through the pipeline is evaluated against tenant-editable approval rules before commit. When a rule says the actor's role suffices, the command proceeds; when no rule matches, the safe default applies — require review — and the command is rejected with a stable `APPROVAL_REQUIRED` code (the pending-approval flow itself ships with the financial-core spec, per the spine spec's approval decision; ARCHITECTURE.md §5.2).

**Blocked by:** 03 — Command pipeline core.

**Status:** ready-for-agent

- [ ] `approval_rules` table: command type, category, branch, amount range, required role — tenant-editable rows
- [ ] Pipeline evaluation step before commit; handlers contain no approval logic
- [ ] Safe default proven by test: command with no matching rule → `APPROVAL_REQUIRED`, nothing committed
- [ ] Seed rules give spine commands their catalog defaults (§5.1): register/commission/assign auto for the asset-manager permission
- [ ] Evaluation outcome recorded on the command receipt (auto-approved vs would-require-approval) so later reporting can show which rules fired
