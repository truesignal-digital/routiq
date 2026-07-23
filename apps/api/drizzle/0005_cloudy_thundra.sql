CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"label_fr" text NOT NULL,
	"label_en" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_command_id" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "command_source_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"original_file_name" text,
	"uploaded_by_principal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_artifacts_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "template_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "commissioned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "custodian_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_created_by_command_id_commands_id_fk" FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_source_artifacts" ADD CONSTRAINT "command_source_artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_source_artifacts" ADD CONSTRAINT "command_source_artifacts_command_id_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_source_artifacts" ADD CONSTRAINT "command_source_artifacts_artifact_id_source_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."source_artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD CONSTRAINT "source_artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD CONSTRAINT "source_artifacts_uploaded_by_principal_id_principals_id_fk" FOREIGN KEY ("uploaded_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_ws_kind_code_uq" ON "categories" USING btree ("workspace_id","kind","code");--> statement-breakpoint
CREATE UNIQUE INDEX "command_artifacts_uq" ON "command_source_artifacts" USING btree ("command_id","artifact_id");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_custodian_membership_id_memberships_id_fk" FOREIGN KEY ("custodian_membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE memberships ADD CONSTRAINT memberships_ws_id_uq UNIQUE (workspace_id, id);
--> statement-breakpoint
ALTER TABLE source_artifacts ADD CONSTRAINT source_artifacts_ws_id_uq UNIQUE (workspace_id, id);
--> statement-breakpoint
ALTER TABLE categories ADD CONSTRAINT categories_ws_id_uq UNIQUE (workspace_id, id);
--> statement-breakpoint
ALTER TABLE assets ADD CONSTRAINT assets_ws_custodian_fk FOREIGN KEY (workspace_id, custodian_membership_id) REFERENCES memberships(workspace_id, id);
--> statement-breakpoint
ALTER TABLE command_source_artifacts ADD CONSTRAINT csa_ws_command_fk FOREIGN KEY (workspace_id, command_id) REFERENCES commands(workspace_id, id);
--> statement-breakpoint
ALTER TABLE command_source_artifacts ADD CONSTRAINT csa_ws_artifact_fk FOREIGN KEY (workspace_id, artifact_id) REFERENCES source_artifacts(workspace_id, id);
--> statement-breakpoint
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON categories
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE source_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON source_artifacts
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE command_source_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE command_source_artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON command_source_artifacts
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON categories TO asset_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON source_artifacts TO asset_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON command_source_artifacts TO asset_app;
