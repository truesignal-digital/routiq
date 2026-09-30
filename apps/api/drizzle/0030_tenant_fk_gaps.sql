-- #72: the catalog invariants test found tenant references that only had the
-- single-column FK drizzle declares. Postgres checks foreign keys without RLS,
-- so each could cite a command in another workspace; the composite key makes
-- that structurally impossible, as 0023 did for branches (#15). All targets
-- are commands, whose (workspace_id, id) key is commands_ws_id_uq
-- (0004_m1_tenant_isolation.sql). NULLs satisfy a composite FK vacuously, so
-- rows born before a column was stamped need no backfill.
--
-- persons.membership_id is left to the identity work (#47), which adds the
-- memberships (workspace_id, id) key it needs.

ALTER TABLE activities ADD CONSTRAINT activities_ws_command_fk
  FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);
--> statement-breakpoint
ALTER TABLE activities ADD CONSTRAINT activities_ws_closed_by_command_fk
  FOREIGN KEY (workspace_id, closed_by_command_id) REFERENCES commands(workspace_id, id);
--> statement-breakpoint
ALTER TABLE activity_asset_segments ADD CONSTRAINT activity_asset_segments_ws_command_fk
  FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);
--> statement-breakpoint
ALTER TABLE activity_people ADD CONSTRAINT activity_people_ws_command_fk
  FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);
--> statement-breakpoint
ALTER TABLE categories ADD CONSTRAINT categories_ws_command_fk
  FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);
--> statement-breakpoint
ALTER TABLE meter_readings ADD CONSTRAINT meter_readings_ws_command_fk
  FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);
--> statement-breakpoint
ALTER TABLE movement_legs ADD CONSTRAINT movement_legs_ws_command_fk
  FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);
--> statement-breakpoint
ALTER TABLE persons ADD CONSTRAINT persons_ws_command_fk
  FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);
--> statement-breakpoint
ALTER TABLE places ADD CONSTRAINT places_ws_command_fk
  FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);
--> statement-breakpoint

-- UPDATE came from the blanket grant in 0004 and no code uses it on these
-- tables: legs and crew are corrected by new rows, sessions are only inserted
-- or deleted (PIN reset), and nothing updates principals or workspaces. Without
-- the grant, an edit cannot slip past a row_version these tables do not have.
REVOKE UPDATE ON activity_people, movement_legs, principals, sessions, workspaces FROM routiq_app;
