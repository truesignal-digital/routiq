CREATE TABLE "workspace_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"preset_code" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_by_command_id" uuid NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_templates" ADD CONSTRAINT "workspace_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_templates" ADD CONSTRAINT "workspace_templates_updated_by_command_id_commands_id_fk" FOREIGN KEY ("updated_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_templates_ws_preset_uq" ON "workspace_templates" USING btree ("workspace_id","preset_code");
--> statement-breakpoint

-- Composite FKs: workspace_templates
ALTER TABLE workspace_templates 
  ADD CONSTRAINT workspace_templates_ws_command_fk 
  FOREIGN KEY (workspace_id, updated_by_command_id) 
  REFERENCES commands(workspace_id, id);

--> statement-breakpoint

-- Enable RLS on workspace_templates
ALTER TABLE workspace_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_templates
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

-- Grant permissions to routiq_app role
GRANT SELECT, INSERT, UPDATE ON workspace_templates TO routiq_app;
