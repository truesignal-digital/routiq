# Multi-branch enablement

Date: 2026-08-06. Branch: `feat/multi-branch`. Driver: partner use-case docs (bus agency + trucking) — every profile story is "per branch"; superboss sees all branches, branch staff see theirs.

## Current state (verified 2026-08-06)

Enforcement machinery is COMPLETE; administration and UX are absent. The system is effectively single-branch.

Built and tested:
- `branches` table (`apps/api/src/db/schema.ts:67-80`): id, workspace_id, code, name, timezone (default Africa/Douala), active. Unique `(workspace_id, code)`. NO `created_by_command_id` / `row_version` columns (created only via provisioning today).
- `branch_id` NOT NULL on assets, activities, persons, financial_entries, financial_postings; composite `(workspace_id, branch_id)` FKs; RLS on branches.
- Membership scope: `memberships.all_branches` bool + `branch_ids uuid[]` (`schema.ts:101-105`) → `BranchScope = "ALL" | string[]` (`contracts/src/roles.ts:30-31`), derived server-side in `apps/api/src/auth/context.ts:32`. Never client-sent.
- Dispatcher enforcement: every command declares `branchAuthorization` (`dispatcher.ts:132-141`), fail-closed registration (`:253-259`), check at `:433-448`. Payloads carry `branchCode` strings resolved via `branchIdsByCode` (`commands/branch-authorization.ts:24-40`).
- Reads all filter by caller scope; optional `branchId` query param narrows, never widens (ADR-0003, `docs/adr/0003-read-side-list-contract.md:31-34`).
- Cross-branch asset transfer = CROSS_BRANCH approval rule (`asset-lifecycle.ts:128-131`, seeded `provisioning/packs/core.ts:61-68`).
- Numbering is branch-prefixed `{branchCode}-{year}-{seq5}` (`commands/numbering.ts:31-61`).

Missing (this effort):
- No create/rename/deactivate branch commands. Only branch creation path is `provision-workspace`, which accepts EXACTLY ONE branch (`contracts/src/commands/provision-workspace.ts:28-32`); user branchScope collapses to that one id (`provision-workspace.ts:138-139`). `branches.active` is written true and never updated by anything.
- No branch admin UI.
- No ambient "current branch" in web shell; branch is a per-form Select that auto-hides when only one branch exists (`FinanceRecordScreen.tsx:187-195`, `PersonsScreen.tsx:54-59,133`).

## Design decisions (fixed — do not relitigate in tasks)

1. **Branch `code` is immutable.** It is the natural key embedded in record numbering (`DLA-2026-00004`). Rename changes `name` only.
2. **Deactivate, never delete.** `set-branch-status` flips `active`. Guard: a workspace must keep ≥1 active branch (`LAST_BRANCH` 409, mirroring `LAST_ADMIN`/`LAST_PRESET` precedent). Inactive branches reject NEW writes targeting them (`BRANCH_INACTIVE` 422) — enforced centrally in `branchIdsByCode` resolution so every branch-targeting command inherits it. Reads/history unaffected. Existing records keep their branch_id.
3. **Branches become ordinary mutable business rows**: migration adds `created_by_command_id` (nullable for pre-existing rows) and `row_version` to `branches`, per the provenance invariant.
4. **Admin commands are workspace-kind** (`branchAuthorization: { kind: "workspace" }`), role ADMIN, module CORE — consistent with members/categories. No approval rules on branch admin (audited, admin-only).
5. **provision-workspace takes `branches: [...]` (1..n)**, replacing singular `branch`. Vendor-only command, two tenants, pre-GA: change in place, no v2. Provisioned users' `branchScope` codes map to the matching subset of branch ids.
6. **Switcher is client state, not session state.** No API "current branch". Shell-level selector (visible when caller's effective scope spans >1 active branch) persisted in localStorage keyed by workspace slug; feeds the existing `branchId` narrow filter on list screens and preselects branch fields in forms. "All my branches" is the default option. Server scope still enforces; switcher can only narrow.
7. **Error codes stable, never English strings**: new codes `DUPLICATE_BRANCH_CODE`, `LAST_BRANCH`, `BRANCH_INACTIVE`, `BRANCH_NOT_FOUND` (if not already covered by `REFERENCE_NOT_FOUND{referenceType:"branch"}` — reuse that where it fits). fr + en catalog entries required (guard test `error-map.test.ts` enforces coverage).
8. **French word for branch is "Agence"** everywhere (normalized 2026-08-06 on ui/preset-vocabulary).

## Task sequence (one issue file each; loop = implement → evaluate → test (visual for UI tasks) → commit → next)

1. `01-create-branch-command.md` — schema migration + contracts + handler + tests
2. `02-branch-admin-commands.md` — rename-branch, set-branch-status, inactive-branch write guard
3. `03-provision-multi-branch.md` — provision-workspace branches array
4. `04-branch-admin-ui.md` — branches read + management screen
5. `05-branch-switcher.md` — shell switcher + ambient current-branch wiring
6. `06-final-pass.md` — E2E visual walkthrough, docs (ARCHITECTURE refs, CONTEXT.md), cleanup

Definition of done per task: typecheck + relevant vitest suites green (api suites need Docker), reviewed by orchestrator, UI tasks visually verified in browser, committed on `feat/multi-branch` with focused message.
