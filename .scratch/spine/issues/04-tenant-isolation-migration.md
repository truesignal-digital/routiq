# 04 — M1 tenant isolation migration (RLS + composite FKs + audit lockdown)

**What to build:** Cross-tenant access becomes structurally impossible, provable below the application layer. A raw database connection as the runtime role, with two seeded workspaces, cannot read the other workspace's rows, cannot create a cross-tenant reference, and cannot modify or delete audit history — even with app code out of the picture entirely (ARCHITECTURE.md §4.4 layers 2–3, §4.3).

**Blocked by:** 03 — Command pipeline core (business tables must exist to isolate).

**Status:** ready-for-human

- [x] RLS on `workspace_id` with `FORCE ROW LEVEL SECURITY` on every tenant table; policies keyed to `app.workspace_id`
- [x] Pipeline transaction helper applies `SET LOCAL app.workspace_id` at transaction start (pool-safe); all existing integration tests still pass through it
- [x] Dedicated runtime role without BYPASSRLS; migrations run as a separate owner role
- [x] Composite tenant FKs — `FOREIGN KEY (workspace_id, referenced_id)` — on every cross-table business reference
- [x] Runtime role has UPDATE/DELETE revoked on audit events
- [x] Raw-DB seam test: as runtime role with workspace A set, selecting workspace B's assets returns zero rows
- [x] Raw-DB seam test: inserting a row referencing another workspace's asset fails on the composite FK
- [x] Raw-DB seam test: UPDATE and DELETE on an audit event are denied

## Comments

- Implemented 2026-07-22 in migration 0004. RLS includes sessions as well as the command/business tables; composite FKs cover tenant-scoped principal, branch, command, and approval-rule references. Raw runtime-role tests prove cross-tenant reads/inserts are blocked and audit mutation privileges are absent.
- Fable review (2026-07-23), deferred items: app still connects as the privileged owner — moving it to `routiq_app` needs an auth-path design first (session/credential lookups run before tenant context; RLS on those tables will block them). Role password hardcoded 'routiq_app' — rotate per environment. Grants don't cover future tables (no ALTER DEFAULT PRIVILEGES) — every new migration must grant explicitly. Receipt→rule composite FK means a fired approval rule can't be hard-deleted (supersede instead) — kept deliberately.
