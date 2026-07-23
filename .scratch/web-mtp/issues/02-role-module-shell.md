# 02 — Role, branch, and module-aware shell

**What to build:** The shell renders only what the signed-in member can actually do: role gates every mutating affordance, branch scope pre-filters reads, disabled modules remove their nav sections entirely.

**Blocked by:** None (backend dependency: `enabledModules` on `/v1/me` — spine session, done 2026-07-23).

**Status:** ready-for-human

- [x] `/v1/me` context (role, branchScope, principalType, enabledModules) loaded once at login, exposed via a provider, refreshed on 401
- [x] EXECUTIVE_VIEWER sees zero submit/mutate affordances anywhere (asserted by a component test per screen as screens land)
- [x] Nav sections for a disabled module (e.g. ASSETS off) are absent, not greyed
- [x] Branch-scoped members see lists pre-filtered to their branches; ALL-scope sees everything
- [x] Component tests for the three gate types (role, module, branch)

## Comments

- Done (2026-07-23, web-ui). `useMe()` TanStack Query (workspace-scoped key, retry:false) fetches `/v1/me` once per session; 401 → session dropped via `sessionStore.logout` so the route guard re-prompts PIN. `MeCtx` provider wraps the shell; screens read via `useMeContext()`.
- Module gate: `visibleSections(enabledModules)` — nav sections owned by a disabled module are absent (not greyed); while membership loads only module-less sections (Plus) render. The web-foundation ticket 04 nav-hardcode debt is thereby retired.
- Role gate: `isReadOnlyRole` — EXECUTIVE_VIEWER (or unknown) hides all three register affordances on the assets screen (header pill, FAB, empty-state CTA); asserted by a jsdom component test rendering the real screen under both roles. Per-screen assertions continue as screens land (tickets 03–06).
- Branch gate: server-side pre-filtering already in the reads; client adds `scopedByBranch` (defense-in-depth for selects) — pure-tested. Component tests: 8 new (module 3, role 2 + jsdom render 2, branch 2 within me.test).
- Verified live: ADMIN sees Actifs (from enabledModules) + register affordances. 56 web tests, typecheck clean.
