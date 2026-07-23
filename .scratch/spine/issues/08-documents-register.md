# 08 — Documents register

**What to build:** A compliance clerk records insurance, permits, and licenses against an asset with expiry dates, and renews them without ever losing history: renewal inserts a new document that supersedes the old, and the original is never edited. A disposed/retired/written-off asset refuses new operational records — proven here on documents, enforced generically for everything later (ARCHITECTURE.md §3.1 Document, §3.4 invariants 2 & 4).

**Blocked by:** 07 — Asset lifecycle commands.

**Status:** ready-for-agent

- [ ] One documents table; document types come from the seeded categories
- [ ] AddOrRenewDocument: renewal inserts a new row with a supersedes reference; superseded originals are immutable through the command layer
- [ ] Attempting to edit a document directly (any command shape) has no path — corrections only supersede
- [ ] Lifecycle invariant enforced in the pipeline, not the handler: SOLD / RETIRED / WRITTEN_OFF assets reject new operational records with a stable code
- [ ] Integration test: add → renew → the old version still readable, unmodified, chain intact; add on a retired asset → rejected
