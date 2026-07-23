# 02 — Login + session

**What to build:** A provisioned user signs in with username + PIN and stays signed in: the PIN field triggers the numeric keyboard on mobile (password-style on desktop), the session persists via refresh token (≥ 14 days per §6), expiry re-prompts PIN only with the username remembered, and unauthenticated visitors are routed to login from any protected route. Logout works (surface can be temporary until ticket 04's More section). Sessions are stored keyed by username — never one global blob — so shared-device fast-switching can land later without redesign (deferred to the offline spec).

**Blocked by:** 01 — Scaffold; spine 02 — Auth, memberships, and roles (`.scratch/spine/issues/02-auth-memberships-roles.md`).

**Implementation note:** run in a git worktree; touches `apps/web` (+ contracts if auth response types are shared).

- [x] Login screen: username + PIN, numeric-friendly PIN input, French labels and errors
- [x] Wrong PIN → stable error code rendered as a French message (`errors.*` namespace)
- [x] Session persists across app restarts; expiry re-prompts PIN only, username prefilled
- [x] Sessions keyed by username in storage
- [x] Route guard: every non-login route redirects unauthenticated users to login and returns them after
- [x] Logout clears the session for that username only
- [x] Verified against the real API (spine 02) — no mocked auth in the demo path

## Comments

- Implemented (2026-07-23, worktree `web-02-login`). Login screen carries a third field the ticket didn't name: **workspace slug** — required by the `loginRequest` contract (multi-tenant login). PIN input `inputMode=numeric` + `type=password`. Route restructure: pathless `app` layout route guards all business routes (`beforeLoad` redirect to `/login` with return path); `/login` bounces already-authed users to `/assets`. Sessions in localStorage keyed **workspace:username** (upgraded from ticket's literal per-username wording — same-named users in two tenants no longer evict each other), `lastIdentity` survives logout/expiry for PIN-only re-prompt. Logout temporary on More until ticket 04.
- Verified live against real API + seeded Postgres (throwaway container :5434, migrations applied, user amina/246810 @ sotrafret): unauth redirect → French login; wrong PIN → "Nom d'utilisateur ou code PIN incorrect."; login → /assets; reload keeps session; logout → prefilled workspace+username, empty PIN. 85 tests green.
- Review (two-axis, sub-agents) applied: open-redirect guard on the return path (internal paths only); unknown error codes render generic message + raw code for support; `loginResponse` Zod schema added to contracts (replaces hand-rolled guard); shared `extractApiError` helper dedupes auth + command-client error walks; workspace-scoped session keys (above).
- Recorded, not fixed here: **no refresh endpoint server-side** — the 14-day session is fixed-expiry, a daily-active user gets hard-logged-out; needs a spine follow-up (sliding renewal or refresh route) before pilot. Guard is navigation-time only (cross-tab logout/expiry unnoticed until next navigation) — acceptable this slice, revisit with offline spec. `MoreStub` outgrew its name — rename lands with ticket 04's rebuild.
- Dev-verify recipe (not committed): postgres:17-alpine on :5434, apply `drizzle/*.sql` via psql, seed workspace/principal/membership/credential with `hashPin`, run api with `DATABASE_URL=...5434 PORT=3001 tsx src/server.ts`, web `vite --port 5175`.
