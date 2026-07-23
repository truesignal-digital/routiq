# 08 — Documents register

**What to build:** A compliance clerk records insurance, permits, and licenses against an asset with expiry dates, and renews them without ever losing history: renewal inserts a new document that supersedes the old, and the original is never edited. A disposed/retired/written-off asset refuses new operational records — proven here on documents, enforced generically for everything later (ARCHITECTURE.md §3.1 Document, §3.4 invariants 2 & 4).

**Blocked by:** 07 — Asset lifecycle commands.

**Status:** ready-for-human

- [x] One documents table; document types come from the seeded categories
- [x] AddOrRenewDocument: renewal inserts a new row with a supersedes reference; superseded originals are immutable through the command layer
- [x] Attempting to edit a document directly (any command shape) has no path — corrections only supersede
- [x] Lifecycle invariant enforced in the pipeline, not the handler: SOLD / RETIRED / WRITTEN_OFF assets reject new operational records with a stable code
- [x] Integration test: add → renew → the old version still readable, unmodified, chain intact; add on a retired asset → rejected

## Comments

- Implemented (2026-07-23) by a codex worker, reviewed by Fable. `documents` table (migration 0006, in the base commit) is append-only with a `supersedes_document_id` back-pointer; a unique index allows exactly one renewal per document (`DOCUMENT_ALREADY_SUPERSEDED` on the second), and supersession is derived — the original row is never touched, proven byte-identical in the test. Renewal must match the original's asset and document type. Document types validate against seeded DOCUMENT_TYPE categories.
- The §3.4 disposed-asset invariant is now pipeline-owned: CommandDefinitions declare `operationalAssetId` and the dispatcher rejects SOLD/RETIRED/WRITTEN_OFF targets with `ASSET_NOT_OPERATIONAL` before handlers run. assign-asset was refactored onto the gate (its in-handler check deleted); add-or-renew-document never had one. Every future operational command inherits the invariant by declaration.
- No edit path exists anywhere in the registry (asserted by test). FIELD_SUBMITTER can record documents per catalog defaults.
