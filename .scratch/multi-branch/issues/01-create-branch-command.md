# 01 — create-branch.v1 command

Status: done (2026-08-06)
Depends: —

## Goal

ADMIN can add a branch to an existing workspace through the command pipeline.

## Scope

1. **Migration** (drizzle): add to `branches`: `created_by_command_id uuid` (nullable — pre-existing rows have none) referencing commands like sibling tables do, and `row_version integer not null default 1`. Update `apps/api/src/db/schema.ts` accordingly. Generate via `pnpm db:generate`; inspect generated SQL.
2. **Contract** `packages/contracts/src/commands/create-branch.ts`: payload `strictObject { branchId: z.uuid() (client-generatable), code, name, timezone?: string }`. Code: uppercase alphanumeric 2–8 chars (`/^[A-Z0-9]{2,8}$/`) — it prefixes record numbers. Name: trimmed nonempty ≤120. Compose `commandEnvelope`. Export from contracts index like siblings. Contract test (mirror `register-asset.test.ts` style): valid payload parses, bad code rejected, unknown keys rejected.
3. **Handler** `apps/api/src/commands/create-branch.ts`: `CommandDefinition`, name `create-branch`, version 1, role ADMIN, module CORE, `branchAuthorization: { kind: "workspace" }`, no approval. Execute: insert branch (active true, timezone default Africa/Douala when omitted, `created_by_command_id` = this command); on `(workspace_id, code)` unique violation → 409 `DUPLICATE_BRANCH_CODE`; audit event `branch-created`. Follow an existing simple handler (e.g. `register-person.ts`) for receipt/audit shape. Register in the same place siblings register.
4. **Error code**: add `DUPLICATE_BRANCH_CODE` to contracts error-code list; add fr ("Ce code d'agence existe déjà dans votre espace.") + en ("This branch code already exists in your workspace.") to both locale catalogs (`errors.*` namespace — guard test enforces).
5. **API tests** (vitest, testcontainers): happy path creates branch + receipt + audit row; duplicate code → 409 DUPLICATE_BRANCH_CODE; idempotent retry returns original result; non-ADMIN → 403; branch usable immediately (register an asset into it in the same test).

## Out of scope

Rename/deactivate (02), provisioning (03), any UI (04/05). No i18n beyond the error strings.

## Evaluate before build

Confirm audit-event naming convention (`branch-created` vs existing patterns in `history.event.*` keys) and whether history read needs a label entry (`history.event.branch-created` fr/en) — if the record-history UI lists unknown events raw, add the two label strings.

## Verify

`pnpm typecheck`; `pnpm --filter @routiq/contracts test`; `pnpm --filter @routiq/api exec vitest run src/commands/create-branch.test.ts` (Docker required); `pnpm --filter @routiq/web exec vitest run src/i18n`.
