CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"asset_code" text NOT NULL,
	"asset_class_code" text NOT NULL,
	"template_code" text NOT NULL,
	"lifecycle_status" text DEFAULT 'REGISTERED' NOT NULL,
	"registration_number" text,
	"chassis_number" text,
	"manufacturer" text,
	"model" text,
	"model_year" integer,
	"acquisition_date" date,
	"acquisition_amount_minor" bigint,
	"currency" text DEFAULT 'XAF' NOT NULL,
	"custom_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_by_command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_command_id_commands_id_fk" FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_ws_code_uq" ON "assets" USING btree ("workspace_id","asset_code");