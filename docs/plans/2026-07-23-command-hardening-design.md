# Command hardening design

Date: 2026-07-23
Status: approved

## Goal

Harden ROUTIQ's existing command spine before activities or finance expand it:

1. normal application traffic runs through a PostgreSQL role without `BYPASSRLS`;
2. optimistic concurrency is one atomic database write;
3. branch-scoped writes are authorized centrally;
4. named command routes become canonical without breaking the generic route immediately.

The active Web MTP documents-screen work is outside this change except that it inherits
the canonical command transport through the shared web command client.

## Architecture

Keep the modular monolith and the existing dispatcher. Add small reusable seams rather
than duplicating checks in handlers:

- a privileged authentication/bootstrap database connection;
- a restricted application database connection;
- a tenant-transaction helper that applies `SET LOCAL app.workspace_id`;
- a compare-and-swap helper for mutable rows;
- declarative branch targets on `CommandDefinition`;
- named HTTP route facades over the same dispatcher.

The generic `POST /v1/commands` endpoint remains temporarily compatible. New client
traffic uses `POST /v1/commands/:name`; both routes execute the same registered command
definition and transaction pipeline.

## Data flow

1. The bootstrap connection verifies a session and resolves its workspace membership.
2. Authenticated reads and commands use the restricted application connection.
3. Each application transaction sets its server-derived workspace with transaction-local
   PostgreSQL configuration before touching tenant data.
4. A command definition declares any source and destination branches relevant to the
   mutation.
5. The dispatcher validates role and branch scope, module entitlement, idempotency,
   operational state, and approval requirements.
6. A mutable handler performs a conditional update whose predicate includes the expected
   row version. It succeeds only when exactly one row is returned.
7. Business rows, the command receipt, and audit events commit or roll back together.

Tenant, actor, and branch authority never come from the request body.

## Authorization semantics

For ordinary commands, every declared branch must be inside the authenticated membership's
branch scope. `ALL` permits every workspace branch.

Asset mutations authorize the asset's current branch. Registering an asset authorizes the
requested branch. Adding or renewing a document authorizes the owning asset's branch.

Assignment distinguishes two concerns:

- the actor must be authorized for the asset's current/source branch;
- moving to another branch may still require approval under the existing approval rules.

Destination approval does not grant permission to mutate an asset from an unauthorized
source branch.

## Error handling

No new user-facing error vocabulary is required:

- out-of-scope writes return `ROLE_FORBIDDEN` with non-sensitive metadata;
- missing references continue to return `REFERENCE_NOT_FOUND`;
- a missing expected version returns `EXPECTED_VERSION_REQUIRED`;
- a zero-row conditional update returns `VERSION_CONFLICT`;
- both HTTP route shapes return identical stable error envelopes.

Unexpected database or handler failures remain `COMMAND_FAILED` and are reported through
the existing observability seam without payload contents.

## Testing seams

The primary seam is Fastify injection against real migrated PostgreSQL:

- normal server traffic operates through the restricted role;
- tenant reads and commands succeed only after transaction-local workspace scoping;
- a branch-scoped member cannot register, commission, assign, or add a document outside
  their branch;
- cross-branch assignment preserves its existing approval behavior for an authorized
  source asset;
- two concurrent commands using the same row version yield exactly one success and one
  `VERSION_CONFLICT`;
- named and compatibility routes return the same success, replay, and error behavior;
- the web command client targets the named route.

The secondary seam remains raw SQL through `routiq_app`, proving RLS and revoked audit
privileges independently of application code.

Run package tests, full typecheck, and the complete workspace test suite after the focused
red/green cycles.
