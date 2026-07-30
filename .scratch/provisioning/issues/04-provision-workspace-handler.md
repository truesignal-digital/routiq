# 04 — `provision-workspace.v1` handler

Status: resolved
Blocked by: 02, 03

## Task

The composite platform command. One transaction: workspace + first branch + admin user + enabled presets + starter-pack replay, all stamped with the provision command id.

## Requirements

- `apps/api/src/commands/provision-workspace.ts` implementing `CommandDefinition` with the platform scope from issue 02; side-effect import in `server.ts` per the dispatcher checklist (`dispatcher.ts:77-89`).
- Execute order inside the transaction:
  1. `workspaces` row (reject duplicate slug with a stable error code — 409, not a raw 23505).
  2. `branches` row.
  3. Admin: `principals` (HUMAN) + `memberships` (ADMIN, `allBranches: true`) + `credentials` (`hashPin`, mirroring `seedMember` / `loginWithPin` conventions).
  4. `workspace_templates` rows for each `enabledPresets` entry, `updatedByCommandId` = this command.
  5. `workspace_modules` rows ONLY for `disabledModules` entries (absent-means-enabled semantics preserved).
  6. Pack replay: core pack + one pack per enabled preset (issue 03), categories and approval rules inserted with `createdByCommandId` = this command. Direct inserts are correct here per spec non-scope (runtime category commands are research item 3).
- Receipt: `commands` row with `workspaceId` = the created workspace (per issue 02's decision); `recordId` = workspace id.
- Audit: `appendAuditEvent` with workspace/branch/admin summary (no PIN — never log or audit the PIN or its hash).
- Warnings channel: none expected; return empty.
- Tests (pattern: sibling command tests using the in-process dispatch from issue 02):
  - happy path creates all rows, every row's provenance column points at the command
  - created admin can actually log in (`loginWithPin`) and execute a tenant command
  - duplicate slug → stable 409
  - single-preset workspace gets exactly that preset's categories + core, no cross-contamination
  - idempotent replay returns original receipt, no duplicate rows

## Acceptance

- [ ] `pnpm typecheck` passes
- [ ] All new tests pass; full api suite green
- [ ] `grep` shows no remaining production path that inserts categories/approval rules without a command id (test helpers exempt)

## Comments

2026-07-30 — Done (Opus 5 worker + review). apps/api/src/commands/provision-workspace.ts (+6 tests), packs/index.ts (PRESET_PACKS total over TEMPLATE_CODES — new preset without pack fails compile), server.ts import, DUPLICATE_WORKSPACE_SLUG error code + fr/en strings. Duplicate slug = pre-check SELECT → stable 409 (unique index remains race backstop). Insert order: branch → principal → membership → credential (composite FK) → templates → disabled modules only → pack replay (direct inserts, stamped). Audit workspace.provisioned via appendPlatformAuditEvent; test asserts PIN + "pinHash" absent from stored trail. E2E test: loginWithPin with provisioned credential → register-asset over HTTP 200 (proves packs + approval rules live). 41 files / 354 api tests green; typecheck green. Review note for later: replayPacks reads approvalRules from core pack only (preset packs have no such field today); guard added in issue 06 pass.
