-- Platform-scope command receipts (vendor-operator provisioning, ADR-0004).
--
-- A vendor operator holds no membership in any workspace — that is the point of
-- the principal — so `commands_ws_principal_fk` as written in 0004 makes a
-- provisioning receipt unwritable. The invariant it encodes ("a receipt's actor
-- is a member of the workspace it is filed under") is still exactly right for
-- every workspace command, so it moves onto the generated
-- `tenant_actor_principal_id` (0016) rather than being weakened: that column is
-- NULL only for PLATFORM rows, and MATCH SIMPLE leaves a composite FK with a
-- NULL member unchecked. Workspace rows are affected in no way.

ALTER TABLE commands DROP CONSTRAINT commands_ws_principal_fk;

--> statement-breakpoint

ALTER TABLE commands
  ADD CONSTRAINT commands_ws_principal_fk
  FOREIGN KEY (workspace_id, tenant_actor_principal_id)
  REFERENCES memberships(workspace_id, principal_id);

--> statement-breakpoint

-- Same move for the audit trail the platform command writes into the workspace
-- it just created: same actor, same reason, same NULL-member exemption.
ALTER TABLE audit_events DROP CONSTRAINT audit_events_ws_principal_fk;

--> statement-breakpoint

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_ws_principal_fk
  FOREIGN KEY (workspace_id, tenant_actor_principal_id)
  REFERENCES memberships(workspace_id, principal_id);
