# 02 — Login + session

**What to build:** A provisioned user signs in with username + PIN and stays signed in: the PIN field triggers the numeric keyboard on mobile (password-style on desktop), the session persists via refresh token (≥ 14 days per §6), expiry re-prompts PIN only with the username remembered, and unauthenticated visitors are routed to login from any protected route. Logout works (surface can be temporary until ticket 04's More section). Sessions are stored keyed by username — never one global blob — so shared-device fast-switching can land later without redesign (deferred to the offline spec).

**Blocked by:** 01 — Scaffold; spine 02 — Auth, memberships, and roles (`.scratch/spine/issues/02-auth-memberships-roles.md`).

**Implementation note:** run in a git worktree; touches `apps/web` (+ contracts if auth response types are shared).

- [ ] Login screen: username + PIN, numeric-friendly PIN input, French labels and errors
- [ ] Wrong PIN → stable error code rendered as a French message (`errors.*` namespace)
- [ ] Session persists across app restarts; expiry re-prompts PIN only, username prefilled
- [ ] Sessions keyed by username in storage
- [ ] Route guard: every non-login route redirects unauthenticated users to login and returns them after
- [ ] Logout clears the session for that username only
- [ ] Verified against the real API (spine 02) — no mocked auth in the demo path
