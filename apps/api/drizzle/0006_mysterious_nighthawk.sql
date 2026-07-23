CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"document_type_code" text NOT NULL,
	"title" text,
	"document_number" text,
	"issued_at" date,
	"expires_at" date,
	"supersedes_document_id" uuid,
	"created_by_command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_command_id_commands_id_fk" FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_supersedes_uq" ON "documents" USING btree ("workspace_id","supersedes_document_id");--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT documents_ws_id_uq UNIQUE (workspace_id, id);
--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT documents_ws_asset_fk FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id);
--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT documents_ws_command_fk FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);
--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT documents_ws_supersedes_fk FOREIGN KEY (workspace_id, supersedes_document_id) REFERENCES documents(workspace_id, id);
--> statement-breakpoint
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT ON documents TO asset_app;
