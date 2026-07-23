# 03 — Command pipeline core + RegisterAsset

**What to build:** An authenticated asset manager posts a RegisterAsset command to the single command endpoint and gets back a committed asset with full provenance: the asset row, the command receipt, and the append-only audit event all commit in one transaction. Retrying the exact same submission returns the original result instead of creating a duplicate; reusing the idempotency key with a different payload is rejected as a conflict. This is the fixed pipeline every future command rides (ARCHITECTURE.md §5.3): the dispatcher owns authenticate → authorize → idempotency → schema validation → atomic commit; the handler owns only invariants and writes. (Module check, concurrency check, and approval evaluation slots land in tickets 05/07/06.)

**Blocked by:** 02 — Auth, memberships, and roles.

**Status:** ready-for-agent

- [ ] One command endpoint takes name + envelope + payload; envelope's tenant/actor/branch are never read from the request body
- [ ] Role check: a member without the required permission gets a stable authorization error
- [ ] Idempotency: `(workspace_id, idempotency_key)` unique; exact retry (same payload) returns the stored original outcome marked as a replay; same key + different payload → 409 with stable code
- [ ] RegisterAsset (existing contract schema) writes an asset row with `created_by_command_id`, client-generated UUID honored
- [ ] Command receipt stores actor, origin, payload, and outcome; audit event stores before/after state, changed fields, actor membership, entity refs
- [ ] Asset row + receipt + audit event commit atomically — a forced mid-commit failure leaves no partial state observable
- [ ] All error responses are stable machine codes with metadata, never English strings
- [ ] Every request log line carries command id + workspace id (Pino, §8 observability convention)
- [ ] Invalid payload → schema-validation error code; unknown command name/version → stable not-found code
