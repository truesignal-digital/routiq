# 02 — Auth, memberships, and roles

**What to build:** A provisioned user can authenticate and the server resolves who they are — workspace, membership, one of the six fixed roles, branch scope — entirely server-side. An unauthenticated request to any protected surface is rejected with a stable error code. Identity verification sits behind a thin app-owned interface: tests use a local implementation; Supabase is one implementation behind the same interface, and the username/PIN field-role path is app-owned (per ARCHITECTURE.md §6a guard 1, §10).

**Blocked by:** 01 — Integration test harness.

**Status:** ready-for-human

- [x] Memberships link a principal to a workspace with exactly one fixed role (admin, ops manager, field submitter, maintenance, finance approver, executive viewer) and a branch scope; roles are a code-level registry, not tenant data
- [x] `principal_type` HUMAN | AI_AGENT | INTEGRATION carried through; nothing assumes HUMAN
- [x] Identity verification behind one narrow interface; no Supabase types or SDK calls visible outside its implementation module
- [x] Username/PIN credential path works for field roles (admin-provisioned, no email flow)
- [x] Unauthenticated request → stable error code, never an English sentence
- [x] Integration test: authenticated request resolves the correct workspace/role/branch scope into the command context; a request cannot supply its own tenant or branch scope

## Comments

- Implemented (2026-07-22): `memberships`/`credentials`/`sessions` tables (migration 0001); role + principal-type registries and stable error codes in `@routiq/contracts`; `IdentityProvider` seam with `LocalSessionProvider` (opaque sha256-hashed session tokens, 14-day TTL); scrypt PIN hashing with cost params encoded in the hash; timing-equalized login (dummy verify on unknown username); `requireAuth` hook + `GET /v1/me`; dispatcher `CommandContext` now aliases the server-derived `AuthContext`.
- Deliberately deferred, carried by later tickets:
  - Admin provisioning commands (create member/credential) → ticket 03 command pipeline; tests seed directly for now.
  - `row_version`/`created_by_command_id` on `memberships`/`credentials`, composite tenant FKs, and a possible `membership_branches` join table (branch_ids is a bare uuid[]) → tickets 03/04.
  - Fastify's own 400 for malformed JSON still emits English text; global error-envelope handler → ticket 03.
  - When Supabase provider lands: workspace selection for multi-workspace principals must stay server-side (do NOT read a client workspace header inside the provider); `/v1/auth/login` sessions and Supabase tokens will need a composite verifier.
  - PIN attempt throttling / lockout → security hardening backlog.
