# 02 — rename-branch.v1 + set-branch-status.v1 + inactive-branch guard

Status: open
Depends: 01

## Goal

Branch lifecycle administration: rename (name only — code immutable), deactivate/reactivate with invariants.

## Scope

1. **Contracts**: `rename-branch.ts` payload `{ branchId: uuid, name }` + `expectedVersion` usage via envelope; `set-branch-status.ts` payload `{ branchId: uuid, active: boolean }`. Tests.
2. **Handlers**: both ADMIN, CORE, workspace-kind, optimistic concurrency against `branches.row_version`. rename: update name, bump row_version, audit `branch-renamed` (old/new name in payload snapshot per audit conventions). set-branch-status: flip active, bump row_version, audit `branch-deactivated`/`branch-reactivated`. Guards: deactivating the last ACTIVE branch → 409 `LAST_BRANCH` (mirror `LAST_ADMIN` implementation in `members.ts:154-177`, including the advisory-lock pattern if members use one for the count check); no-op status change → 409 (mirror `PRESET_ALREADY_SET` precedent).
3. **Inactive-branch write guard**: in `branchIdsByCode` (`apps/api/src/commands/branch-authorization.ts:24-40`) — or a sibling resolver if payload-target resolution happens elsewhere for some commands — resolving a branch that is inactive → 422 `BRANCH_INACTIVE`. This must cover register-asset, create-activity, register-person, record-financial-entry, record-sheet targeting an inactive branch. IMPORTANT: `assetBranchIds` (mutating an asset whose CURRENT branch is inactive) must stay allowed for lifecycle commands (you must be able to transfer assets OUT of a deactivated branch) — think through which resolver each command uses and add a test proving transfer-out still works. Cross-branch assign INTO an inactive branch must fail.
4. **Error codes + locales**: `LAST_BRANCH` (fr "Votre espace doit garder au moins une agence active." / en "Your workspace must keep at least one active branch."), `BRANCH_INACTIVE` (fr "Cette agence est désactivée : aucune nouvelle opération n'est possible." / en "This branch is deactivated: no new operations are possible."). History event labels fr/en for the three new events if task 01 established that pattern.
5. **API tests**: rename happy + stale expectedVersion 409; deactivate last active branch → LAST_BRANCH; deactivate one of two → ok; new asset into inactive branch → BRANCH_INACTIVE; transfer asset out of inactive branch → allowed (approval flow intact); reactivate → writes accepted again.

## Out of scope

Membership scope cleanup when a branch deactivates (members keep their ids; scope simply matches nothing active — acceptable, note in code comment only if a constraint needs stating). UI.

## Evaluate before build

Check whether `update-approval-threshold` or approval-rule matching reads branch active state anywhere — deactivation must not break rule matching for historical contexts.

## Verify

`pnpm typecheck`; contracts tests; `pnpm --filter @routiq/api exec vitest run src/commands/branch-admin.test.ts src/commands/branch-authorization.test.ts` (Docker).
