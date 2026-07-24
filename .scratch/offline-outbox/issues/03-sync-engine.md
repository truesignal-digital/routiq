# 03 — Sync engine: drain, reconnect, park, export

**What to build:** A background sync loop drains the outbox FIFO on demand ("Sync now" button) and automatically on reconnect; rejected commands park with error details and remain exportable. A badge shows pending count.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Sync hook in `apps/web/src/offline/sync.ts` maintains outbox state: monitor `navigator.onLine` and fire drain on `online` event
- [ ] Drain loop: iterate outbox status=queued, replay each by calling the transport directly with the stored envelope + token (auth token persisted at login); NOT via submit() which would re-enqueue
- [ ] One rejection doesn't block the rest; park with `status=error, errorCode, errorMessage` (fr message from server or fallback)
- [ ] 401 on replay sets outbox `status=auth-required`, prompts re-login in UI, resumes drain on next Sync attempt
- [ ] JSON export of parked/queued entries: `exportOutbox()` returns array of {commandName, payload, error} for download/share-sheet (clerk hands to support)
- [ ] Pending badge in header shows count of queued+error entries; UI disables "Sync now" during active drain
- [ ] Unit tests: FIFO ordering, one rejection doesn't stop drain, 401 parks queue, export JSON shape valid
