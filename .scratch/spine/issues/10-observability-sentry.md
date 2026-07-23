# 10 — Observability: Sentry wiring

**What to build:** Unhandled errors and pipeline failures reach Sentry with enough context to debug production: command id, workspace id, command name, origin — and never any financial evidence or payload contents (ARCHITECTURE.md §8 observability row). Local dev and tests run with Sentry disabled by default.

**Blocked by:** 03 — Command pipeline core.

**Status:** ready-for-agent

- [ ] Sentry initialized from env config; absent DSN = cleanly disabled (dev, CI, tests)
- [ ] Fastify error handler reports unhandled errors with command id, workspace id, command name, origin as tags
- [ ] Expected command rejections (validation, idempotency conflict, authorization) are NOT reported — only unexpected failures
- [ ] No payload contents, no evidence data, no PII in Sentry events or breadcrumbs
- [ ] Verified by test: a forced handler crash produces one captured event with the right tags (Sentry SDK in test transport mode), and a 422 validation rejection produces none
