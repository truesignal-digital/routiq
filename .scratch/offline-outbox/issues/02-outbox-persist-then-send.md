# 02 — Outbox persistence: capture → Dexie → send

**What to build:** The command submit path persists immutable envelopes to a Dexie outbox before attempting network send. Envelopes survive power cuts; the store gains a `queued` state to mark unresolved commands displayed as "en attente de synchronisation".

**Blocked by:** nothing

**Status:** ready-for-agent

- [ ] Dexie schema in `apps/web/src/offline/db.ts`: `outbox` table with (id, workspaceId, commandName, version, envelope, payload, status, createdAt, errorCode, errorMessage)
- [ ] In `apps/web/src/commands/client.ts` `submit()`, persist the complete `CommandSubmission` envelope to outbox BEFORE fetch attempt; capture both success and rejection paths
- [ ] Add `queued` to the `CommandStatus` discriminated union in `apps/web/src/commands/store.ts` (alongside `submitting`, `committed`, `rejected`); offline commands render as "en attente de synchronisation", never as success
- [ ] Outbox entries are write-once: envelope and payload never regenerated or edited on replay
- [ ] Unit tests: persist → send round-trip, power-cut survival (close db mid-submit, reopen, verify envelope exists), fetch success clears queued entry
