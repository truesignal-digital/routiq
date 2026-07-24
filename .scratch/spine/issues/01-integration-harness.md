# 01 — Integration test harness

**What to build:** A developer can run the API integration test suite against a real, disposable Postgres: the suite starts a container, applies the project's migrations, builds the server, and asserts through the server's inject interface. The existing health check passes against this real database, proving the loop end to end.

**Blocked by:** None — can start immediately.

**Status:** ready-for-human

- [x] Test suite boots a Testcontainers Postgres 17 and applies all drizzle migrations before tests run
- [x] A shared fixture provides the built server + a database handle to tests; containers are reused across the file run (not per-test) for speed
- [x] Health check test passes through the fixture against the real database
- [x] `pnpm --filter @routiq/api test` runs the whole thing with no local Postgres or manual setup (Docker required is fine)
- [x] Existing unit tests (contracts, domain) still pass unchanged

## Comments

- Implemented (2026-07-22): vitest `globalSetup` (`apps/api/src/test/global-setup.ts`) starts one `postgres:17-alpine` Testcontainer per suite run and applies drizzle migrations; `src/test/fixture.ts` provides built server + drizzle handle; `buildServer` now takes `{ db, logger? }` and `/health` runs `select 1` through it, so the health test exercises server → real Postgres.
