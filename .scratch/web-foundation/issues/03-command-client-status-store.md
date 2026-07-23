# 03 — Command client + in-flight status store

**What to build:** The single seam every form writes through. Give the command client a command name + payload: it generates the envelope (command id, idempotency key, `expectedVersion` when editing), posts to the command endpoint, and exposes the submission's true state per ADR-0001 — `submitting → committed | rejected(code)` — in an in-flight command store the UI renders from. Forms never see HTTP; the offline outbox later swaps this module's transport (POST → enqueue) and adds a `queued` state without touching a single form. This is the one deliberately non-vertical ticket: a prefactor proven at the unit seam, integrated end-to-end by ticket 06.

**Blocked by:** None — can start immediately (pure logic against the existing contracts envelope; live integration lands in ticket 06).

**Implementation note:** run in a git worktree; touches `packages/contracts` (envelope helpers — coordinate: the spine session also edits contracts; keep the helpers in new files) and `apps/web`.

- [ ] Envelope generation helpers live in the contracts package (shared with the future React Native client): command id UUID, idempotency key, `expectedVersion` wiring, origin `HUMAN_UI`
- [ ] Idempotency key is created when a submission starts and is stable across retries of that submission — unit-proven
- [ ] Status store transitions unit-proven: `submitting → committed`, `submitting → rejected(code)`; idempotent-replay response resolves as `committed`, never as a duplicate
- [ ] Stable error codes surface as codes (translation happens at the UI layer via the `errors.*` namespace)
- [ ] No optimistic cache patching anywhere in the module (ADR-0001)
- [ ] Pure unit tests, no DOM, following the existing contracts test pattern
