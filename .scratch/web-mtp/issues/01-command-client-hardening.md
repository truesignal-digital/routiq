# 01 — Command client hardening + complete error map

**What to build:** The existing command client becomes the guaranteed-safe write path: identical-envelope retries, expectedVersion support, and a complete localized error map. Every later screen assumes these properties; none re-implements them.

**Blocked by:** None — can start immediately.

**Status:** ready-for-human

- [x] Command client generates commandId + idempotencyKey once per user intent and reuses them across retries; a timeout/double-submit resubmits the identical envelope and `idempotentReplay: true` is surfaced as plain success
- [x] Client accepts optional `expectedVersion` and threads it into the envelope; result type is discriminated on `@routiq/contracts` `ApiErrorCode`
- [x] i18n error map covers EVERY code exported by `@routiq/contracts` in both fr and en — proven by a meta-test that imports the code arrays and asserts a translation exists per code per locale
- [x] `TEMPLATE_FIELD_INVALID` and `VALIDATION_FAILED` metadata map to per-field messages, not one blob
- [x] Unknown/future code renders a generic fr fallback and logs the raw code to console
- [x] Unit tests: retry reuses the key; replay renders success; each discriminated branch reachable

## Comments

- Done (2026-07-23, web-ui). Built on the existing client rather than replacing it: `SubmitResult` failure code now typed `ApiErrorCode | "NETWORK_ERROR" | (string & {})`; new `createCommandIntent` formalizes one-envelope-per-user-intent (wraps the SubmissionCache; unchanged payload → identical envelope, proven by a test asserting byte-equal envelopes across a timeout retry, replay → plain success; edited payload → fresh envelope). `expectedVersion` was already threaded via `createSubmission` options.
- Error map completed: every code in the contracts registry (auth 3 + validation 1 + command 18) plus client-side NETWORK_ERROR/READ_FAILED has fr AND en entries — enforced by a meta-test importing the code arrays (registry grows → test fails until translated). `errorMessage(i18n, code)` centralizes unknown-code fallback (generic + raw code + console.warn); Login and RegisterAsset screens refactored onto it.
- Field-level metadata mapping extracted to `field-errors.ts`: TEMPLATE_FIELD_INVALID (missingRequired/wrongType/unknownKeys) and VALIDATION_FAILED (`issues[{code,path}]` → per-path messages) both land on exact fields via setError; RegisterAsset screen uses both.
- Discriminated branches proven reachable by parameterized tests (VERSION_CONFLICT, IDEMPOTENCY_KEY_REUSED, APPROVAL_REQUIRED, MODULE_DISABLED, TEMPLATE_FIELD_INVALID, ASSET_NOT_OPERATIONAL).
- Verified e2e on the canonical compose stack (:5435, seeded via scripts/seed-dev.ts): register flow green post-refactor. 48 web tests, typecheck clean.
