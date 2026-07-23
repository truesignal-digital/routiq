# 01 — Command client hardening + complete error map

**What to build:** The existing command client becomes the guaranteed-safe write path: identical-envelope retries, expectedVersion support, and a complete localized error map. Every later screen assumes these properties; none re-implements them.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Command client generates commandId + idempotencyKey once per user intent and reuses them across retries; a timeout/double-submit resubmits the identical envelope and `idempotentReplay: true` is surfaced as plain success
- [ ] Client accepts optional `expectedVersion` and threads it into the envelope; result type is discriminated on `@asset/contracts` `ApiErrorCode`
- [ ] i18n error map covers EVERY code exported by `@asset/contracts` in both fr and en — proven by a meta-test that imports the code arrays and asserts a translation exists per code per locale
- [ ] `TEMPLATE_FIELD_INVALID` and `VALIDATION_FAILED` metadata map to per-field messages, not one blob
- [ ] Unknown/future code renders a generic fr fallback and logs the raw code to console
- [ ] Unit tests: retry reuses the key; replay renders success; each discriminated branch reachable
