# ROUTIQ project orientation

Date: 2026-07-23

This note orients implementation work from the repository's primary sources. `ARCHITECTURE.md` is authoritative for design decisions; `CLAUDE.md` is the working guide; `.scratch/` is planning and delivery history, not a substitute for the architecture. The tracker convention is one feature directory with a spec and numbered issue files, with status and comments kept in each issue. Sources: [CLAUDE.md:7-11](../../CLAUDE.md#L7-L11), [domain-doc guidance](../agents/domain.md#L5-L11), [issue-tracker convention](../agents/issue-tracker.md#L3-L11).

## What ROUTIQ is

ROUTIQ is a pilot-stage asset-lifecycle and profitability platform for two Cameroonian transport operators. It is designed for French-first users, intermittent connectivity, low-end Android devices, and paper-derived operational facts. The system is a TypeScript modular monolith with one PostgreSQL database: Fastify API, React PWA, shared Zod contracts, and pure domain logic. Reads are REST/SQL views; all writes pass through the command layer. Sources: [CLAUDE.md:5-7](../../CLAUDE.md#L5-L7), [CLAUDE.md:27-35](../../CLAUDE.md#L27-L35), [ARCHITECTURE.md:21-54](../../ARCHITECTURE.md#L21-L54).

| Area | Responsibility |
|---|---|
| `apps/api` | Authentication, command dispatch, read routes, Drizzle schema/migrations |
| `apps/web` | Vite/React 19 PWA, TanStack Router/Query, command client, fr-CM/en UI |
| `packages/contracts` | Shared command envelopes, payload schemas, client command helpers, stable codes |
| `packages/domain` | Pure invariants such as XAF money behavior; no I/O |

Source: [CLAUDE.md:27-35](../../CLAUDE.md#L27-L35).

## Runtime model

1. Authentication resolves the principal, workspace membership, fixed role, and branch scope on the server. Tenant, actor, and branch authority are not client-supplied. The current local path is username/PIN plus a 14-day opaque session behind an `IdentityProvider` seam. Sources: [spine auth ticket:9-23](../../.scratch/spine/issues/02-auth-memberships-roles.md#L9-L23), [auth context](../../apps/api/src/auth/context.ts#L6-L29).
2. A command definition supplies its name/version, module, allowed roles, payload schema, optional approval context, and transactional handler. The dispatcher supplies validation, module gating, idempotency, approval evaluation, receipt handling, provenance, and transaction boundaries. Source: [dispatcher:53-85](../../apps/api/src/commands/dispatcher.ts#L53-L85).
3. The dispatcher starts a transaction, applies the transaction-local workspace RLS setting, checks idempotency, evaluates approval, stages the command receipt, runs the handler, and records the result. Domain rows and audit events are written through that same transaction, so a thrown error rolls them all back. Sources: [dispatcher:176-260](../../apps/api/src/commands/dispatcher.ts#L176-L260), [spine pipeline ticket:9-23](../../.scratch/spine/issues/03-command-pipeline-core.md#L9-L23).
4. The web command client creates one immutable intent per user action. Retries reuse the command ID and idempotency key; edits create a new intent; mutation intents carry the row version that was rendered. The UI does not optimistically patch query caches—it renders server truth plus explicit submitting/conflict/approval states. Sources: [web MTP spec:22-31](../../.scratch/web-mtp/spec.md#L22-L31), [ADR-0001](../adr/0001-command-lifecycle-rendering-over-optimistic-updates.md#L1-L3).
5. Offline support is intentionally command replay rather than record synchronization. Future Dexie/IndexedDB storage will hold immutable envelopes, drafts, queued blobs, and a branch snapshot; physical facts may reconcile later, while approvals/locks/releases always require the server. Sources: [CLAUDE.md:61-65](../../CLAUDE.md#L61-L65), [ARCHITECTURE.md:294-304](../../ARCHITECTURE.md#L294-L304).

## Non-negotiable implementation conventions

- Use pnpm only, Node 24+, ESM, strict TypeScript, `.js` intra-package import suffixes, and pinned dependency versions. Do not start dev servers on the assumption they are already running. Sources: [CLAUDE.md:9-25](../../CLAUDE.md#L9-L25), [tsconfig](../../tsconfig.base.json#L1-L15).
- Add a command through a shared payload schema, registered `CommandDefinition`, approval catalog default, and explicit runtime-role grants for any new tables. The dispatcher and registry tests enforce parts of this convention. Source: [dispatcher:53-64](../../apps/api/src/commands/dispatcher.ts#L53-L64).
- Every tenant table carries `workspace_id`; cross-table tenant references use composite foreign keys; mutable rows carry `row_version`; business rows carry command provenance. XAF minor units have exponent zero and are never divided by 100. Sources: [ARCHITECTURE.md:146-157](../../ARCHITECTURE.md#L146-L157), [CLAUDE.md:43-58](../../CLAUDE.md#L43-L58).
- Approved/posted finance and stock facts, meter readings, documents, notes, artifacts, and audit history are corrected by supersession/reversal, not mutation. Sources: [CLAUDE.md:45-55](../../CLAUDE.md#L45-L55), [documents ticket:9-18](../../.scratch/spine/issues/08-documents-register.md#L9-L18).
- Tests should favor external behavior: Fastify `inject` against migrated Testcontainers PostgreSQL, plus narrow raw-runtime-role tests for RLS, composite FKs, and revoked privileges. Sources: [spine spec:96-103](../../.scratch/spine/spec.md#L96-L103), [RLS test:9-12](../../apps/api/src/db/rls.test.ts#L9-L12).

## Current development state

- The backend "spine" through asset registration, commission/assignment, documents, artifacts, module entitlements, approval evaluation, tenant-isolation migrations, and integration harness is recorded as implemented and reviewed. Sources: [spine issues](../../.scratch/spine/issues/), especially [pipeline](../../.scratch/spine/issues/03-command-pipeline-core.md#L19-L23), [tenant isolation](../../.scratch/spine/issues/04-tenant-isolation-migration.md#L18-L21), [lifecycle](../../.scratch/spine/issues/07-asset-lifecycle-commands.md#L16-L20), [artifacts](../../.scratch/spine/issues/09-source-artifacts-storage.md#L16-L20).
- Web MTP tickets 01–05 are recorded complete: command-client hardening, role/module shell, register form, lifecycle conflict UX, and attachment field. The remaining declared slice is the per-asset documents screen. Sources: [web MTP tickets](../../.scratch/web-mtp/issues/), [documents screen](../../.scratch/web-mtp/issues/06-documents-screen.md#L1-L13).
- `.scratch` is chronological delivery evidence and is not always normalized current truth: some older unchecked web-foundation tickets were superseded by completed web-MTP tickets, and the unchecked Sentry ticket coexists with Sentry source wiring. Confirm tracker claims against current code before acting on them. Sources: [web-foundation module ticket](../../.scratch/web-foundation/issues/04-module-nav-more-section.md#L9-L14), [web-MTP shell completion](../../.scratch/web-mtp/issues/02-role-module-shell.md#L7-L20), [Sentry ticket](../../.scratch/spine/issues/10-observability-sentry.md#L7-L13), [dispatcher Sentry call](../../apps/api/src/commands/dispatcher.ts#L290-L297).
- The current working tree contains uncommitted document-screen/read-route work. Treat those files as user work and do not overwrite them while hardening the backend.
- Activities, financial postings/approval flow/period lock, maintenance/stock, reports, and offline capture remain later Phase 1 work. The architecture's build order puts activities before the financial core; hardening the shared security and concurrency rails should precede either. Source: [ARCHITECTURE.md:417-433](../../ARCHITECTURE.md#L417-L433).

## Constraints for the recommended hardening

### 1. Make the runtime database role real

The architecture requires `FORCE ROW LEVEL SECURITY`, transaction-local `app.workspace_id`, and an application role without `BYPASSRLS`. Migration `0004` creates `routiq_app`, grants it table privileges, and revokes audit mutation privileges. Sources: [ARCHITECTURE.md:219-229](../../ARCHITECTURE.md#L219-L229), [migration 0004:3-23](../../apps/api/drizzle/0004_m1_tenant_isolation.sql#L3-L23).

The running API does not currently use that role: both `.env.example` and the DB client's fallback connect as the `routiq` owner. Thus the raw-role RLS tests prove the policies, but normal API traffic can bypass them. Sources: [.env.example](../../.env.example#L1-L3), [DB client](../../apps/api/src/db/client.ts#L5-L9), [tenant-isolation ticket caveat](../../.scratch/spine/issues/04-tenant-isolation-migration.md#L18-L21).

Constraint: authentication and membership lookup happen before a tenant-scoped command transaction. Simply changing `DATABASE_URL` to `routiq_app` would cause RLS-protected credential/session/membership lookups to see no rows when `app.workspace_id` is unset. The hardening needs an explicit bootstrap-auth design (for example, a narrowly privileged auth connection or a tenant-setting auth transaction), followed by tenant-scoped runtime transactions for command and read paths. Sources: [auth plugin:19-29](../../apps/api/src/auth/plugin.ts#L19-L29), [auth context:6-19](../../apps/api/src/auth/context.ts#L6-L19), [tenant-isolation ticket caveat](../../.scratch/spine/issues/04-tenant-isolation-migration.md#L20-L21).

### 2. Make optimistic concurrency atomic

The current lifecycle handlers read a row, compare `expectedVersion` in memory, then update by workspace and ID only. Two concurrent transactions can both read the same version and both succeed, so the check is not atomic. Sources: [version helper](../../apps/api/src/commands/dispatcher.ts#L301-L312), [commission update](../../apps/api/src/commands/asset-lifecycle.ts#L26-L63), [assignment update](../../apps/api/src/commands/asset-lifecycle.ts#L128-L203).

The required shape is a conditional write (`... WHERE id = ? AND workspace_id = ? AND row_version = expectedVersion`) that increments the version and verifies exactly one returned row; zero rows becomes `VERSION_CONFLICT`. Put this behind a shared command-layer helper so every future mutable command gets the same guarantee, including module toggles, which currently also read and then update by ID. Preserve the command transaction so a conflict also rolls back the staged receipt/audit work. Sources: [module toggle:31-59](../../apps/api/src/commands/module-toggle.ts#L31-L59), [ARCHITECTURE.md:275-279](../../ARCHITECTURE.md#L275-L279).

### 3. Centralize branch-scoped write authorization

Branch scope is present in `AuthContext`, and read routes filter with it, but command dispatch currently authorizes only the role. Handlers resolve branches/assets by workspace without asserting that the source or target branch is in the actor's scope. A branch-scoped member can therefore attempt writes against another branch in the same workspace. Sources: [auth context:21-29](../../apps/api/src/auth/context.ts#L21-L29), [dispatcher role check:158-164](../../apps/api/src/commands/dispatcher.ts#L158-L164), [register branch lookup](../../apps/api/src/commands/register-asset.ts#L30-L42), [document asset lookup](../../apps/api/src/commands/add-or-renew-document.ts#L22-L35).

Authorization belongs in the shared pipeline, not scattered through handlers. The command definition needs a declarative way to expose the relevant branch target(s), with the dispatcher enforcing membership scope before approval or execution. Cross-branch assignment needs deliberate semantics: authorization of the current/source asset is distinct from approval of a transfer destination. The architecture requires role **and branch** authorization before the rest of the pipeline. Sources: [ARCHITECTURE.md:25-36](../../ARCHITECTURE.md#L25-L36), [ARCHITECTURE.md:275-277](../../ARCHITECTURE.md#L275-L277).

### 4. Resolve the command-route documentation conflict before changing routes

The authoritative architecture specifies named write endpoints such as `POST /v1/commands/record-expense` and explicitly rejects a generic execution surface so each command can be independently permissioned, rate-limited, documented, and represented in generated clients. Source: [ARCHITECTURE.md:46-54](../../ARCHITECTURE.md#L46-L54).

The later spine spec, `CLAUDE.md`, implementation, and web client instead standardize on one generic `POST /v1/commands` whose body contains `name`, `version`, `envelope`, and `payload`. Sources: [spine spec:46-54](../../.scratch/spine/spec.md#L46-L54), [CLAUDE.md:37-41](../../CLAUDE.md#L37-L41), [command route](../../apps/api/src/commands/routes.ts#L5-L21), [web foundation client contract](../../.scratch/web-foundation/issues/03-command-client-status-store.md#L18-L21).

This is a real source conflict, not a cosmetic mismatch. Preserve the single dispatcher/write pipeline, but record an ADR choosing the external HTTP shape. If the architecture remains authoritative, add named route façades over the dispatcher and migrate the shared client; do not duplicate handlers or transaction logic. Update `CLAUDE.md` and `.scratch` guidance in the same change so future commands cannot drift back.

## Safe hardening order

1. Decide and test the auth/bootstrap connection boundary, then run tenant application traffic as `routiq_app`.
2. Introduce the atomic versioned-update helper and migrate existing mutable handlers.
3. Introduce declarative branch targets and pipeline-owned branch authorization.
4. Resolve the external command-route shape with an ADR and compatibility/migration plan.
5. Re-run typecheck, unit tests, API Testcontainers integration tests, and raw-role tests; add API-path tests proving cross-branch writes are rejected and concurrent stale writes produce exactly one success.

This order keeps current user-facing document work isolated while repairing the shared rails that all future activity and finance commands will inherit.
