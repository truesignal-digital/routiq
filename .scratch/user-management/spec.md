# User management — day-2 member administration

Today users exist only at workspace birth: `provision-workspace.v1` creates
admin + initial users, once, vendor-side. A driver quits, a clerk is hired,
someone forgets a PIN → SQL by hand. This spec gives the tenant ADMIN the
member lifecycle through ordinary audited commands plus a Users screen.

Module entitlements are explicitly NOT here — they are platform-scope
(ADR-0005), vendor CLI only; the tenant sees them read-only.

## Current state (verified 2026-07-30)

- Model complete: `principals` (`principal_type`), `memberships` (role from
  the fixed `ROLES` registry, `all_branches`/`branch_ids`, `row_version`),
  `credentials` (workspace-unique username, `pin_hash`, `failed_attempts`,
  `locked_until`, `disabled_at` — disable/lock columns already exist,
  nothing writes them), `sessions`.
- Roles are code-level (`packages/contracts/src/roles.ts`): tenants cannot
  add or re-permission roles. This spec does not change that.
- Dispatcher already has the `redactPayload` seam so secrets never reach the
  `commands.payload` receipt (provision-workspace uses it for PINs).
- No member commands, no member read, no screen. `persons` (workers/crew) is
  a separate domain concept — a driver may exist as a person with no login;
  linking person ↔ membership is out of scope here.

## Commands

All: module `CORE`, `allowedRoles: ["ADMIN"]`, workspace scope,
`branchAuthorization: { kind: "workspace" }`, audit events as listed. PINs
always through `redactPayload`; PIN never in receipt, audit, or logs.

### `add-member.v1`
Principal + membership + credential in one transaction (client-generated
`principalId`). Payload: `principalId`, `displayName`, `username`, `pin`,
`role`, `branchScope` (`ALL` | branch ids, validated same-workspace).
Duplicate username → 422 `USERNAME_TAKEN` (stable code, not the raw unique
violation). Audit: `member.added`.

### `update-member-role.v1`
Role and/or branch scope on an existing membership; `expectedVersion` against
`memberships.row_version`. Invariant: **a workspace always has ≥1 active
ADMIN** — demoting the last one → 422 `LAST_ADMIN`. Audit:
`member.role-updated` (before/after role + scope in event states).

### `deactivate-member.v1`
Sets `memberships.deactivated_at` (new column — the authorization boundary)
and `credentials.disabled_at` (the login boundary), deletes the member's
`sessions` rows. Auth pipeline change: `resolveAuthContext` rejects
deactivated memberships. Guards: not self (`SELF_DEACTIVATION` — lockout
foot-gun), not the last active ADMIN (`LAST_ADMIN`). Deactivation is not
deletion: every historical row keeps pointing at the principal, and per §10
the member's unsynced offline drafts live on their device and are never
destroyed — draft recovery by an admin is a separate deferred effort (noted
in non-scope). Audit: `member.deactivated`.

### `reactivate-member.v1`
Clears both timestamps. Audit: `member.reactivated`.

### `reset-member-pin.v1`
Admin sets a new PIN (no email flow exists by design, §6a guard 1): rehash,
clear `failed_attempts`/`locked_until`, delete existing sessions. Doubles as
the unlock command — no separate unlock verb. Audit: `member.pin-reset`
(event records that a reset happened, never the value).

## Read — `GET /v1/members`

ADMIN-only. Memberships joined to principals + credentials: `principalId`,
`displayName`, `username`, `role`, `branchScope`, `status`
(ACTIVE/DEACTIVATED/LOCKED — locked derived from `locked_until > now()`),
`createdAt`. `{ items, nextCursor }` per ADR-0003, keyset on
`(display_name, principal_id)` — a pilot workspace has tens of members, one
page in practice. Include deactivated members (filterable), since the screen
is also where reactivation happens.

## UI — Users screen (More → « Utilisateurs »)

Route under More, visible to ADMIN only (same permission-gating pattern as
existing More links).

- **List**: DataTable (per UI-registry conventions) — name, username, role,
  branch scope, status badge (Actif / Désactivé / Verrouillé). Deactivated
  rows visually muted, hidden behind a filter toggle by default.
- **Add**: header button → form (sheet on mobile): display name, username,
  PIN + confirm, role select (six fixed roles, labels from i18n), branch
  scope (all branches / pick list). Command lifecycle rendering per ADR-0001.
- **Row actions**: change role/scope (small form, sends
  `update-member-role.v1` with `expectedVersion`), reset PIN (new PIN + 
  confirm; on success show a "hand this to the user" confirmation —
  the PIN exists nowhere after this dialog closes), deactivate (confirm
  dialog naming the person; explains history is kept), reactivate.
- **Guard surfacing**: `LAST_ADMIN` / `SELF_DEACTIVATION` / `USERNAME_TAKEN`
  render as specific inline messages, not generic toasts.
- i18n fr-CM + en for all of the above; French copy is the primary.

## Non-scope

- Email/SMS invites — no email flow by design; admin hands out username+PIN.
- Self-service PIN change — pilot operates admin-mediated; revisit with
  operators.
- Roles as tenant data, per-user permission overrides — refused by design
  (fixed registry).
- Person ↔ membership linking (crew who also log in) — real, but a domain
  modeling question for its own session.
- Offline-draft recovery for revoked users (§10) — needs the offline outbox
  export path; separate effort, tracked here so it isn't forgotten.
- Vendor console / platform UI — vendor stays on CLI (ADR-0004/0005).

## Build order

1. Schema (`memberships.deactivated_at`) + contracts for the five commands
   (+ payload tests).
2. Handlers + auth-pipeline rejection of deactivated memberships (+ tests:
   last-admin, self-deactivation, username collision, PIN redaction in
   receipt, session invalidation).
3. `GET /v1/members` read (+ isolation tests).
4. Users screen: list + add form.
5. Row actions (role change, reset PIN, deactivate/reactivate).
