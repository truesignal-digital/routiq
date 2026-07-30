# 02 — Vendor-operator principal + platform-command dispatch path

Status: resolved
Blocked by: 01

## Task

The dispatcher assumes a workspace-bound `AuthContext` and wraps execute in `inWorkspace` RLS. `provision-workspace` runs under a vendor operator with **no workspace binding** — the workspace is created inside execute. Build the smallest seam that allows this without weakening the tenant pipeline.

## Requirements

- **Operator principal**: a `principals` row (workspace-free already) — decide `principalType`: reuse `INTEGRATION` or add `VENDOR_OPERATOR` to `PRINCIPAL_TYPES` (`packages/contracts/src/roles.ts`). Prefer adding the explicit type: ARCHITECTURE.md §7 plans the same seam for AI and explicitness is the point. No membership, no credentials row (identity = CLI with DB access for now; provenance row only).
- **Platform command marker** on `CommandDefinition`: e.g. `scope: "platform"` vs default `"workspace"`. Platform commands:
  - are accepted ONLY for the operator principal type; tenant sessions get 403 (stable error code, not English).
  - skip branch authorization, module check, and `evaluateApproval` (approval rules are per-workspace rows; none can exist).
  - are exempt from the `registry.test.ts` invariant that every command has an approval-defaults entry — adjust that test to assert exemption applies ONLY to platform-scoped commands, so the invariant stays strong for tenant commands.
  - still get: payload validation, idempotency (receipt lookup must handle `workspace_id` for the receipt row — decide: receipts table `workspaceId` for a provision command = the created workspace's id, written by execute; idempotency lookup for platform commands scans by idempotencyKey + operator principal instead of workspace. Look at `commands_ws_idem_uq` and decide the least invasive shape — a partial index variant is acceptable), receipt row, audit event.
  - run in a transaction WITHOUT `inWorkspace` GUC (use the `authDb`/`routiq` bypass client the way login does — `apps/api/src/db/client.ts`), since RLS has no workspace to scope to yet. Confine this exception to platform scope structurally (type-level or assert), not by convention.
- **Operator context**: a distinct `OperatorContext` type rather than a nullable-field `AuthContext` — don't make every tenant handler defensive. `dispatchCommand` accepts `AuthContext | OperatorContext` and refuses mismatched scope/context pairs both ways.
- No HTTP route. This seam is reachable only in-process (CLI, tests).
- Tests: platform command with tenant session → 403; tenant command with operator context → 403; idempotent replay of a platform command returns original receipt.

## Acceptance

- [ ] `pnpm typecheck` passes
- [ ] New tests pass; full `pnpm --filter @routiq/api test` stays green (registry invariant reshaped, not deleted)
- [ ] No tenant-command code path can run with the RLS bypass client

## Comments

2026-07-30 — Done (Opus 5 worker + review). Design: PlatformCommandDefinition (separate type, no tenant fields possible) + registerPlatformCommand; OperatorContext discriminated by kind:"platform"; PlatformDb wrapper type so the RLS-bypass connection is not structurally a Db (dispatchCommand overloads forbid cross-pairing at compile time, requireTenantDb/requirePlatformDb at runtime). Idempotency: commands.scope column + generated tenant_actor_principal_id (NULL for PLATFORM) so the membership FK stays enforced for workspace rows (MATCH SIMPLE skips NULL); partial unique index commands_platform_idem_uq on (initiated_by_principal_id, idempotency_key) WHERE EXECUTED+PLATFORM. createWorkspace hook resolves the FK ordering (workspace → receipt → stamped rows). Failed platform commands leave no receipt (workspace FK rolled back with them) — CLI sees the error. Migrations 0016_mute_tarantula + 0017_platform_command_scope, applied. registry.test reshaped: invariants scoped to workspace commands + explicit platform-exemption assertion. 8 tests in platform-scope.test.ts; full api suite 348 green; typecheck green.
