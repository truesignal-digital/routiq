# 03 — Command client + in-flight status store

**What to build:** The single seam every form writes through. Give the command client a command name + payload: it generates the envelope (command id, idempotency key, `expectedVersion` when editing), posts to the command endpoint, and exposes the submission's true state per ADR-0001 — `submitting → committed | rejected(code)` — in an in-flight command store the UI renders from. Forms never see HTTP; the offline outbox later swaps this module's transport (POST → enqueue) and adds a `queued` state without touching a single form. This is the one deliberately non-vertical ticket: a prefactor proven at the unit seam, integrated end-to-end by ticket 06.

**Blocked by:** None — can start immediately (pure logic against the existing contracts envelope; live integration lands in ticket 06).

**Implementation note:** run in a git worktree; touches `packages/contracts` (envelope helpers — coordinate: the spine session also edits contracts; keep the helpers in new files) and `apps/web`.

- [x] Envelope generation helpers live in the contracts package (shared with the future React Native client): command id UUID, idempotency key, `expectedVersion` wiring, origin `HUMAN_UI`
- [x] Idempotency key is created when a submission starts and is stable across retries of that submission — unit-proven
- [x] Status store transitions unit-proven: `submitting → committed`, `submitting → rejected(code)`; idempotent-replay response resolves as `committed`, never as a duplicate
- [x] Stable error codes surface as codes (translation happens at the UI layer via the `errors.*` namespace)
- [x] No optimistic cache patching anywhere in the module (ADR-0001)
- [x] Pure unit tests, no DOM, following the existing contracts test pattern

## Comments

- Implemented (2026-07-22, worktree `web-03-command-client`), TDD at the pure unit seam: `createSubmission` in `@asset/contracts` (new `src/client/` dir — no spine file overlap except one index export line) generates commandId + idempotencyKey once per submission; retry re-posts the same object, proven on the wire by a test asserting identical keys across a failed and retried fetch. `CommandStatusStore` (`submitting → committed | rejected(code)`, resubmit returns to `submitting`) is `useSyncExternalStore`-ready; `createCommandClient` takes injected `getToken`/`fetchImpl`/`store` — ticket 02's session layer plugs into `getToken` without changes here.
- API contract read from spine implementation: POST `/v1/commands` `{name, version, envelope, payload}`, Bearer auth, 200 → `CommandOutcome` incl. `idempotentReplay`; error body `{error:{code, metadata?}}`. Replay resolves `committed`. Malformed 200 body resolves `rejected`, never `committed`.
- Verified: typecheck green; 53 tests green (16 new: 5 contracts, 11 web).
- Review note: sub-agent review infra was down (classifier outage, 3 retries); review performed inline against both axes instead. Findings: none hard; recorded `CommandResult` (contracts) duplicating the API's internal `CommandOutcome` — spine session should adopt the contracts type to kill the drift risk; `SubmitResult.code` kept as `string` deliberately (unknown codes fall back to generic message in the errors.* namespace).
- `NETWORK_ERROR` is a client-side code, not an API code — needs an `errors.*` entry when ticket 06 renders messages.
