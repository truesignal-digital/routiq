# 07 — Asset lifecycle: categories, CommissionAsset, AssignAsset

**What to build:** An asset manager takes a registered asset through its early lifecycle: commission it into service, assign it to a branch or custodian. Assets carry a category from the seeded TRUCKING / PASSENGER_TRANSPORT presets and template-validated `custom_values`. Two people editing the same asset collide safely: the second save with a stale version is rejected with a conflict. A cross-branch transfer evaluates to `APPROVAL_REQUIRED` (usable once the approval flow lands in the financial-core spec) (ARCHITECTURE.md §3.1, §3.3, §5.1).

**Blocked by:** 03 — Command pipeline core; 06 — Approval-rule evaluation step.

**Status:** ready-for-human

- [x] `categories` table (asset classes, activity types, revenue/expense categories, document types, issue types) with bilingual fr/en labels; TRUCKING and PASSENGER_TRANSPORT preset seeds defined in code
- [x] Assets stamp `template_code` + version; `custom_values` JSONB validated in the command layer against the typed per-template field list — invalid extras rejected with a stable code
- [x] CommissionAsset: lifecycle transition with state-transition checks (cannot commission twice, cannot commission a disposed asset)
- [x] AssignAsset: branch/custodian assignment; same-branch auto per seeded rules; cross-branch → `APPROVAL_REQUIRED`
- [x] Optimistic concurrency wired in the dispatcher: mutations of existing rows require the envelope's `expectedVersion`; stale version → stable conflict code; `row_version` increments on every successful mutation
- [x] Integration test: register → commission → assign happy path, all three rows of provenance (record, receipt, audit) present at each step

## Comments

- Implemented (2026-07-23) by a codex worker, reviewed by Fable. `categories` table + bilingual TRUCKING/PASSENGER_TRANSPORT presets seeded per workspace; register-asset now reference-validates the asset class and validates `custom_values` against the typed per-template field list (`templates.ts`, TEMPLATE_FIELD_INVALID with unknown/wrong-type/missing-required metadata), stamping `template_version`. CommissionAsset (REGISTERED→IN_SERVICE only) and AssignAsset (branch/custodian; disposed assets rejected) both require `expectedVersion` (EXPECTED_VERSION_REQUIRED / VERSION_CONFLICT via the dispatcher helper) and bump `row_version`. Cross-branch assignment: `approvalContext` marks CROSS_BRANCH; the seeded rule requires FINANCE_APPROVER, which `allowedRoles` excludes — so every cross-branch attempt is APPROVAL_REQUIRED until the pending-approval flow ships (financial-core spec).
- Fable: fixed a defensive branch using COMMAND_FAILED instead of VALIDATION_FAILED. Worker's removal of forged customValues in the pipeline tenant test is correct — template validation now rejects unknown keys outright.
- Note: assigning identical values is still a recorded mutation (rowVersion bump + audit) — treated as intentional re-affirmation, not an error.
