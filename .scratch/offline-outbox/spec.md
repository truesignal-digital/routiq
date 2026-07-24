# Spec: Offline outbox — capture safely now, commit later

Status: draft
Source: ARCHITECTURE.md §6 (authoritative), web-mtp spec ("offline is a seam, not a feature yet"), ADR-0001 (server truth + explicit pending state), command client seam `apps/web/src/commands/client.ts`
Owner: UI session (branch `web-ui`) — `apps/web/**` only; contracts additions flagged per ticket; no API changes expected (replay uses existing named routes + idempotency).

## Problem statement

The pilot's field reality is intermittent connectivity on low-end Android. Today every submit dies with `NETWORK_ERROR` the moment the network drops; a clerk mid-form loses the capture. The backend was built for replay — client-generated UUIDs, workspace-scoped idempotency keys, envelope-version tolerance — but the browser never exploits it. §6's promise is "capture safely now, validate and commit later", explicitly NOT an offline-first replica.

## Solution shape

Persist-then-send through the existing seam. `submit()` writes the immutable envelope to a Dexie outbox FIRST, then attempts immediate network drain. Online behavior is unchanged from the user's view (write → send → result); offline or power-cut mid-submit, the envelope survives and replays later as the same idempotent call. Forms don't change: the seam swap the client was designed for (client.ts header comment) is this spec.

## Implementation decisions

- **Persist-then-send, one code path.** No "if offline enqueue else fetch" fork. Every submit: (1) persist envelope to outbox, (2) drain attempt. Durability against power cuts comes free; online latency cost is one IndexedDB write (~ms).
- **Outbox entries are immutable envelopes** — exactly the `CommandSubmission` shape: name, version, envelope (commandId, idempotencyKey, expectedVersion, sourceArtifactIds), payload. Never regenerated, never edited. Replay = identical bytes.
- **Store vocabulary grows one state: `queued`.** ADR-0001 wording holds: server truth + explicit pending. `queued` renders as "en attente de synchronisation", never as success. No optimistic cache patches.
- **Facts queue; decisions don't.** §6: physical facts captured offline are accepted (server flags discrepancies); decisions (approvals, locks, release-to-service, disposal, activity close) always need the server. Each command gets a `queueable` flag in contracts (data, not UI discipline). Non-queueable command while offline → designed state "connexion requise pour cette décision", not an error toast.
- **Sync = manual "Sync now" + auto on `online` event.** FIFO, sequential, each command an independent idempotent call — one rejection doesn't block the rest (it parks). `idempotentReplay: true` is plain success.
- **Rejected commands stay local and exportable.** Park with error code + fr message; JSON export (share sheet / download) so a clerk can hand evidence to support. No auto-retry of rejections — retry is a human decision.
- **Auth across the offline window.** Token stored with the queue; replay uses it. 401 on replay parks the queue (state `auth-required`), prompts re-login, resumes. Server keeps ≥14-day refresh validity and previous-schema tolerance (§6) — backend already committed.
- **Branch snapshot for offline form rendering.** Forms need categories/branches/assets to render. Cache the branch-scoped read responses wholesale in Dexie (few KB, §6), refetched on every successful sync. No cursors, no partial invalidation. Never cache company-wide data (§6 "not a vault").
- **App shell must load offline.** vite-plugin-pwa, precache app shell, installable. Without this the outbox is unreachable when it matters most.
- **Durability surfaced.** `navigator.storage.persist()` requested at login; result shown in settings. Photo queue hard-capped with visible pressure warning.
- **Blobs upload first.** Offline photo → blob row in Dexie keyed by artifactId; sync order: blobs → finalize artifacts → command replay (commands reference `sourceArtifactIds` that must exist server-side first).
- **Per-user stores.** Dexie database name includes user id; logout does NOT clear an outbox with pending entries (warn instead — pending capture is the one thing we must not lose).

## Explicitly out of scope

- Sync protocol, change feeds, CRDTs, conflict merge UI (§13 deferrals). `VERSION_CONFLICT` on replay parks the command like any rejection.
- Pre-allocated numbering ranges (§6) — needs backend allocation endpoint; separate spec.
- Background sync API / periodic sync — manual + reconnect only at MTP.
- Offline reads beyond the branch snapshot (no report caching).

## Testing decisions

- Vitest with fake-indexeddb: outbox persistence round-trip, persist-then-send ordering, FIFO drain, park-on-rejection, replay-identical-envelope guarantees (byte-equal body on retry), queueable-flag gating.
- Meta-test: every command in contracts has an explicit `queueable` boolean (registry guard style).
- One manual end-to-end on a real device: airplane mode → capture document → reconnect → sync → verify chain server-side. Before merge to main.
- Playwright deferred still — the unit seam coverage plus one manual device pass earns MTP.

## Tickets

1. `01-pwa-shell.md` — vite-plugin-pwa, precache, installability, storage.persist()
2. `02-outbox-persist-then-send.md` — Dexie schema, outbox write in submit(), `queued` store state
3. `03-sync-engine.md` — drain loop, Sync now + auto-reconnect, pending/error badge, park + export
4. `04-queueability-policy.md` — contracts `queueable` flag + offline gating of decision commands
5. `05-branch-snapshot.md` — wholesale read cache for offline form rendering
6. `06-offline-blobs.md` — photo blob queue, upload-first sync ordering (depends 03; AttachmentField integration)
