# 08 — E2E smoke (Playwright)

**What to build:** The slice's proof: a Playwright suite drives a real browser against the real API and Postgres (composed test stack riding the spine's Testcontainers foundation) through the full walking skeleton — login with username/PIN → asset list renders in French → register an asset with a photo → in-flight state visible → asset appears in the list. Failure paths and the language switch are covered as variants. This is the primary UI seam per the spec's testing decisions; it runs headless in CI.

**Blocked by:** 07 — Photo attach (the smoke path includes a photo).

**Implementation note:** run in a git worktree; touches `apps/web` (Playwright config/tests) + possibly a compose/test-stack script at the repo root.

- [ ] One command spins the composed stack (API + Postgres + web) and runs the suite headless — no manual setup beyond Docker
- [ ] Smoke path green: login → list (fr) → register with photo → pending indicator observed → asset in list
- [ ] Wrong PIN → French error message asserted
- [ ] Duplicate-retry variant: interrupted submit retried → exactly one asset
- [ ] Language switch to en re-renders chrome; asserted at a mobile viewport (360px) and a desktop viewport
- [ ] Suite is deterministic — no sleeps; waits on visible state only
