# 04 — M1 tenant isolation migration (RLS + composite FKs + audit lockdown)

**What to build:** Cross-tenant access becomes structurally impossible, provable below the application layer. A raw database connection as the runtime role, with two seeded workspaces, cannot read the other workspace's rows, cannot create a cross-tenant reference, and cannot modify or delete audit history — even with app code out of the picture entirely (ARCHITECTURE.md §4.4 layers 2–3, §4.3).

**Blocked by:** 03 — Command pipeline core (business tables must exist to isolate).

**Status:** ready-for-agent

- [ ] RLS on `workspace_id` with `FORCE ROW LEVEL SECURITY` on every tenant table; policies keyed to `app.workspace_id`
- [ ] Pipeline transaction helper applies `SET LOCAL app.workspace_id` at transaction start (pool-safe); all existing integration tests still pass through it
- [ ] Dedicated runtime role without BYPASSRLS; migrations run as a separate owner role
- [ ] Composite tenant FKs — `FOREIGN KEY (workspace_id, referenced_id)` — on every cross-table business reference
- [ ] Runtime role has UPDATE/DELETE revoked on audit events
- [ ] Raw-DB seam test: as runtime role with workspace A set, selecting workspace B's assets returns zero rows
- [ ] Raw-DB seam test: inserting a row referencing another workspace's asset fails on the composite FK
- [ ] Raw-DB seam test: UPDATE and DELETE on an audit event are denied
