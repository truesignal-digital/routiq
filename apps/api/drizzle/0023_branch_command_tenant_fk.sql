-- 0021 gave `branches` a `created_by_command_id` with only the single-column FK
-- to `commands(id)`, so nothing structurally stopped a branch row from citing a
-- command in another workspace. ARCHITECTURE.md §4.1 wants the composite tenant
-- FK, the same shape `assets`, `documents`, `financial_entries` and friends
-- already carry against `commands_ws_id_uq` (0004_m1_tenant_isolation.sql:32).
--
-- The column is nullable — branches born before 0021, and those seeded outside
-- the command layer, carry NULL. A composite FK tolerates that: a NULL
-- component satisfies the constraint vacuously, so no backfill is needed.

ALTER TABLE branches ADD CONSTRAINT branches_ws_command_fk
  FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);
