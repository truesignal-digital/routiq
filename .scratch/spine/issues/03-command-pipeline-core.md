# 03 — Command pipeline core + RegisterAsset

**What to build:** An authenticated asset manager posts a RegisterAsset command to the single command endpoint and gets back a committed asset with full provenance: the asset row, the command receipt, and the append-only audit event all commit in one transaction. Retrying the exact same submission returns the original result instead of creating a duplicate; reusing the idempotency key with a different payload is rejected as a conflict. This is the fixed pipeline every future command rides (ARCHITECTURE.md §5.3): the dispatcher owns authenticate → authorize → idempotency → schema validation → atomic commit; the handler owns only invariants and writes. (Module check, concurrency check, and approval evaluation slots land in tickets 05/07/06.)

**Blocked by:** 02 — Auth, memberships, and roles.

**Status:** ready-for-human

- [x] One command endpoint takes name + envelope + payload; envelope's tenant/actor/branch are never read from the request body
- [x] Role check: a member without the required permission gets a stable authorization error
- [x] Idempotency: `(workspace_id, idempotency_key)` unique; exact retry (same payload) returns the stored original outcome marked as a replay; same key + different payload → 409 with stable code
- [x] RegisterAsset (existing contract schema) writes an asset row with `created_by_command_id`, client-generated UUID honored
- [x] Command receipt stores actor, origin, payload, and outcome; audit event stores before/after state, changed fields, actor membership, entity refs
- [x] Asset row + receipt + audit event commit atomically — a forced mid-commit failure leaves no partial state observable
- [x] All error responses are stable machine codes with metadata, never English strings
- [x] Every request log line carries command id + workspace id (Pino, §8 observability convention)
- [x] Invalid payload → schema-validation error code; unknown command name/version → stable not-found code

## Comments

- Implemented (2026-07-22) by two codex workers (impl + tests) against a fixed contract, reviewed and corrected by Fable. `POST /v1/commands` dispatches through: outer-shape parse → registry lookup → role check → payload schema → one transaction (idempotency lookup → receipt staged → handler → receipt result update). Receipt is staged *before* the handler because `created_by_command_id`/audit FK the `commands` row — a rollback removes it. Concurrent same-key race handled via unique-violation catch + re-read. Drizzle-wrapped pg errors unwrapped via `cause`. `assets` table in migration 0002 (capacity folded into `custom_values` per §3.1).
- Review corrections applied: removed legacy registration shim (defaulted to all roles); 500 path now logs the underlying error and returns stable `COMMAND_FAILED`; auto request-logging replaced with an `onResponse` line through the request-bound child logger so every line carries `commandId` + `workspaceId` (Fastify's built-in completion line binds `reply.log` too early); test gaps fixed (atomicity test now proves rollback of earlier writes; logging test captures a real stream; DB row assertions added).
- Deferred, carried forward: REJECTED/FAILED receipt statuses unused (failed attempts leave the idempotency key free for retry-after-fix — deliberate); `expectedVersion` optimistic concurrency slot → ticket 07; module-enabled check → 05; approval evaluation → 06; register-asset audit `afterState` is hand-built rather than `returning()`-derived (drift risk noted).
