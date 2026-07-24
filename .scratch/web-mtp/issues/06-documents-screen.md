# 06 — Documents per asset: add, renew, chain

**What to build:** A compliance clerk sees an asset's documents grouped by type with expiry badges, adds new ones, and renews — the renewal visibly superseding the old while history stays readable.

**Blocked by:** 04, 05 (attachments optional on documents but expected).

**Status:** ready-for-human

> Happy-path verified 2026-07-24 against compose Postgres: register → add document (INS-001) → renew with supersedesDocumentId → GET /v1/assets/:id/documents returns correct chain (original unchanged, superseded/current links correct). Implementation committed in 3a99ee9.

- [ ] Documents list per asset (needs a `GET /v1/assets/:id/documents` read — UI-owned reads/, GET only), grouped by DOCUMENT_TYPE category, current-vs-superseded distinguished, expiry badges (expired / expiring ≤30d / ok — client-side date math, server stays source of truth)
- [ ] Add document form mirrors `addOrRenewDocumentPayload`; renew pre-fills from the superseded document and sets supersedesDocumentId
- [ ] DOCUMENT_ALREADY_SUPERSEDED and ASSET_NOT_OPERATIONAL rendered as designed states (the latter explains the asset is disposed)
- [ ] Chain view: tapping a superseded document shows its unchanged record and what replaced it
- [ ] FIELD_SUBMITTER can add/renew (role gate allows), EXECUTIVE_VIEWER sees read-only
