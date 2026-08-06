# 03 — provision-workspace accepts multiple branches

Status: done (2026-08-06)
Depends: 01 (schema columns exist)

## Goal

A new tenant can be provisioned with N branches from day one (travel agency: Douala + Yaoundé + Bafoussam).

## Scope

1. **Contract** `packages/contracts/src/commands/provision-workspace.ts`: replace singular `branch: strictObject({id, code, name})` (`:28-32`) with `branches: array(...).min(1).max(20)`, unique codes within payload (superRefine). Keep per-branch `timezone?`. Update contract tests.
2. **Handler** `apps/api/src/commands/provision-workspace.ts`: insert all branches (`:90-94` loop); admin membership stays `allBranches: true` (`:105-110`); provisioned `users[]` `branchScope` codes (`contracts:13-16`) validate against the FULL branch set (`:119-127`) and map to the matching ids — replace the collapse at `:138-139`. `branchScope: "ALL"` users unchanged.
3. **Callers**: update the vendor CLI / any fixture invoking provision-workspace (grep for `branch:` in provisioning CLI, `test/seed.ts`, `preset-enforcement.test.ts:45-74`, appliance/demo seed scripts) to the array shape. docker-compose appliance seed (§6a guard) must still cold-start.
4. **Tests**: provision with 3 branches → all rows exist, numbering prefixes independent; user scoped to 2 of 3 codes → membership branch_ids has exactly those 2; unknown code in user scope → REFERENCE_NOT_FOUND; duplicate codes in payload → validation error.

## Out of scope

Migration of existing tenants (they add branches via create-branch, task 01). UI.

## Evaluate before build

Grep ALL call sites of provision-workspace (tests, CLI, seeds, docs examples in ARCHITECTURE/ADRs) before changing the shape — list them in the report. If ARCHITECTURE.md or an ADR shows the singular payload as an example, update the example.

## Verify

`pnpm typecheck`; contracts tests; `pnpm --filter @routiq/api exec vitest run src/commands/provision-workspace.test.ts src/commands/preset-enforcement.test.ts` (Docker); full api suite green before commit.
