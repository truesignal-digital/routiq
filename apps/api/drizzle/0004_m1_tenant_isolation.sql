-- M1: Tenant isolation via composite FKs and RLS

-- Create runtime role (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'routiq_app') THEN
    CREATE ROLE routiq_app LOGIN PASSWORD 'routiq_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

--> statement-breakpoint

-- Grant schema access
GRANT USAGE ON SCHEMA public TO routiq_app;

--> statement-breakpoint

-- Grant SELECT/INSERT/UPDATE/DELETE on all current tables to routiq_app
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO routiq_app;

--> statement-breakpoint

-- Revoke UPDATE, DELETE on audit_events (append-only)
REVOKE UPDATE, DELETE ON audit_events FROM routiq_app;

--> statement-breakpoint

-- Add unique constraints for composite FK targets
ALTER TABLE branches ADD CONSTRAINT branches_ws_id_uq UNIQUE (workspace_id, id);

--> statement-breakpoint

ALTER TABLE commands ADD CONSTRAINT commands_ws_id_uq UNIQUE (workspace_id, id);

--> statement-breakpoint

ALTER TABLE assets ADD CONSTRAINT assets_ws_id_uq UNIQUE (workspace_id, id);

--> statement-breakpoint

ALTER TABLE approval_rules ADD CONSTRAINT approval_rules_ws_id_uq UNIQUE (workspace_id, id);

--> statement-breakpoint

-- A principal referenced by a tenant row must actually belong to that tenant.
ALTER TABLE credentials
  ADD CONSTRAINT credentials_ws_principal_fk
  FOREIGN KEY (workspace_id, principal_id)
  REFERENCES memberships(workspace_id, principal_id);

--> statement-breakpoint

ALTER TABLE sessions
  ADD CONSTRAINT sessions_ws_principal_fk
  FOREIGN KEY (workspace_id, principal_id)
  REFERENCES memberships(workspace_id, principal_id);

--> statement-breakpoint

ALTER TABLE commands
  ADD CONSTRAINT commands_ws_principal_fk
  FOREIGN KEY (workspace_id, initiated_by_principal_id)
  REFERENCES memberships(workspace_id, principal_id);

--> statement-breakpoint

-- Composite FKs: assets
ALTER TABLE assets 
  ADD CONSTRAINT assets_ws_branch_fk 
  FOREIGN KEY (workspace_id, branch_id) 
  REFERENCES branches(workspace_id, id);

--> statement-breakpoint

ALTER TABLE assets 
  ADD CONSTRAINT assets_ws_command_fk 
  FOREIGN KEY (workspace_id, created_by_command_id) 
  REFERENCES commands(workspace_id, id);

--> statement-breakpoint

-- Composite FKs: audit_events
ALTER TABLE audit_events 
  ADD CONSTRAINT audit_events_ws_command_fk 
  FOREIGN KEY (workspace_id, command_id) 
  REFERENCES commands(workspace_id, id);

--> statement-breakpoint

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_ws_principal_fk
  FOREIGN KEY (workspace_id, actor_principal_id)
  REFERENCES memberships(workspace_id, principal_id);

--> statement-breakpoint

-- Composite FKs: workspace_modules
ALTER TABLE workspace_modules 
  ADD CONSTRAINT workspace_modules_ws_command_fk 
  FOREIGN KEY (workspace_id, updated_by_command_id) 
  REFERENCES commands(workspace_id, id);

--> statement-breakpoint

-- Composite FKs: approval_rules
ALTER TABLE approval_rules 
  ADD CONSTRAINT approval_rules_ws_branch_fk 
  FOREIGN KEY (workspace_id, branch_id) 
  REFERENCES branches(workspace_id, id) 
  MATCH SIMPLE;

--> statement-breakpoint

ALTER TABLE approval_rules
  ADD CONSTRAINT approval_rules_ws_command_fk
  FOREIGN KEY (workspace_id, created_by_command_id)
  REFERENCES commands(workspace_id, id);

--> statement-breakpoint

ALTER TABLE commands
  ADD CONSTRAINT commands_ws_approval_rule_fk
  FOREIGN KEY (workspace_id, approval_rule_id)
  REFERENCES approval_rules(workspace_id, id);

--> statement-breakpoint

-- Enable RLS on workspaces
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspaces
  USING (id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

-- Enable RLS on branches
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON branches
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

-- Enable RLS on memberships
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON memberships
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

-- Enable RLS on credentials
ALTER TABLE credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON credentials
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

-- Enable RLS on sessions
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sessions
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

-- Enable RLS on commands
ALTER TABLE commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE commands FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON commands
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

-- Enable RLS on audit_events
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_events
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

-- Enable RLS on assets
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assets
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

-- Enable RLS on workspace_modules
ALTER TABLE workspace_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_modules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_modules
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

-- Enable RLS on approval_rules
ALTER TABLE approval_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_rules
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
