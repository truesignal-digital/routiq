# 02 — Category command handlers

Status: resolved
Blocked by: 01

## Task

Four thin workspace commands over `categories`, in one handler file `apps/api/src/commands/category.ts`, mirroring `module-toggle.ts` (registerCommand, module CORE, allowedRoles ADMIN, branchAuthorization workspace, before/after audit via appendAuditEvent).

## Requirements

- **create**: insert with client uuid, `active: true`, `createdByCommandId = envelope.commandId`; duplicate (kind, code) → stable 409 `DUPLICATE_CATEGORY_CODE` (pre-check like provision's slug, unique index stays the race backstop). rowVersion 1.
- **relabel**: update labels only; `expectedVersion` honored via `checkOptimisticVersion`; rowVersion bump; audit carries before/after labels.
- **deactivate** / **reactivate**: flip `active`; deactivating an already-inactive row (or vice versa) → idempotent success or stable 409? Decide and document — prefer refusing with `CATEGORY_ALREADY_INACTIVE`/`_ACTIVE` so a stale client learns its picture is old. rowVersion bump; audit.
- Missing categoryId → 422 `REFERENCE_NOT_FOUND` (existing convention — grep for it).
- Approval defaults: add rows in the core pack (`apps/api/src/provisioning/packs/core.ts` — that is where `defaultApprovalRules` content lives now) for all four: ADMIN (+ OPS_MANAGER? mirror what register-person uses — check; pick the least-surprising and note it). Registry invariant test will enforce presence.
- `COMMAND_QUEUEABILITY`: all four are decisions — never offline-queued. Add entries accordingly (grep contracts for the map).
- New error codes → contracts errors + fr/en locale strings (error-map test enforces).
- server.ts side-effect import.
- Tests (sibling style, real dispatch): create then read back; duplicate 409; relabel with stale expectedVersion → conflict; deactivate hides from active pickers (assert via the categories read the web uses if one exists, else row state); reactivate restores; audit rows carry before/after.

## Acceptance

- [ ] `pnpm typecheck` && full `pnpm --filter @routiq/api test` green
- [ ] Registry invariants pass (approval defaults + queueability present)

## Comments

2026-07-30 — Done (Opus 5 worker cat-02 + review). apps/api/src/commands/category.ts + tests: four commands, ADMIN-only, no-op flips refused with CATEGORY_ALREADY_INACTIVE/_ACTIVE (staleness signal), expectedVersion mandatory on relabel only. Worker caught the categories_profitability_layer_ck CHECK the ticket missed — layer required iff financial kind, enforced as 422 CATEGORY_LAYER_INVALID both directions (contract-side refine deferred until the category UI exists to consume it). Approval defaults + queueability (decisions) added; verified api 379 / web 758 / typecheck green.
