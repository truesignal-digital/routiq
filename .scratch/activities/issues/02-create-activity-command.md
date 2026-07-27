# 02 — create-activity.v1 command

Status: ready-for-agent
Blocked by: 01

## Task

New command `create-activity.v1`: contract + handler + tests. Mirror `register-asset` end-to-end (contract shape, handler registration, test style).

## Requirements

- Contract in `packages/contracts/src/commands/create-activity.ts`: Zod payload composing `commandEnvelope`, **with the `z.literal` command-name field like the other 12 contracts** (note: `asset-lifecycle.ts` lacks it — don't copy that one). Zod 4 spellings (`z.uuid()`, `z.iso.date()`). Payload: client-generated activity id, activity type (category ref), branch handled server-side from auth (NEVER client tenant/actor/branch — envelope rule), primary asset id, optional crew list, optional planned route/legs metadata per §3.1.
- Contract test beside it.
- Handler in `apps/api/src/commands/` implementing `CommandDefinition`, registered via `registerCommand`. Approval default: auto (§5.1). Inside the transaction: insert activity + initial PRIMARY segment + crew rows, all stamped `created_by_command_id`.
- Enforce lifecycle gate: no new operational records for SOLD/RETIRED/WRITTEN_OFF assets (§3.4) — stable error code, never English string.
- Handler test: happy path, idempotent retry returns original result, lifecycle-gate rejection, cross-tenant asset ref rejected.

## Acceptance

- [ ] `pnpm typecheck` passes
- [ ] `pnpm --filter @routiq/contracts test` and `pnpm --filter @routiq/api exec vitest run <new test files>` pass
- [ ] Command reachable via `POST /v1/commands/create-activity`
