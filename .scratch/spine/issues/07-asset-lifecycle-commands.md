# 07 — Asset lifecycle: categories, CommissionAsset, AssignAsset

**What to build:** An asset manager takes a registered asset through its early lifecycle: commission it into service, assign it to a branch or custodian. Assets carry a category from the seeded TRUCKING / PASSENGER_TRANSPORT presets and template-validated `custom_values`. Two people editing the same asset collide safely: the second save with a stale version is rejected with a conflict. A cross-branch transfer evaluates to `APPROVAL_REQUIRED` (usable once the approval flow lands in the financial-core spec) (ARCHITECTURE.md §3.1, §3.3, §5.1).

**Blocked by:** 03 — Command pipeline core; 06 — Approval-rule evaluation step.

**Status:** ready-for-agent

- [ ] `categories` table (asset classes, activity types, revenue/expense categories, document types, issue types) with bilingual fr/en labels; TRUCKING and PASSENGER_TRANSPORT preset seeds defined in code
- [ ] Assets stamp `template_code` + version; `custom_values` JSONB validated in the command layer against the typed per-template field list — invalid extras rejected with a stable code
- [ ] CommissionAsset: lifecycle transition with state-transition checks (cannot commission twice, cannot commission a disposed asset)
- [ ] AssignAsset: branch/custodian assignment; same-branch auto per seeded rules; cross-branch → `APPROVAL_REQUIRED`
- [ ] Optimistic concurrency wired in the dispatcher: mutations of existing rows require the envelope's `expectedVersion`; stale version → stable conflict code; `row_version` increments on every successful mutation
- [ ] Integration test: register → commission → assign happy path, all three rows of provenance (record, receipt, audit) present at each step
