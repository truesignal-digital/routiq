CREATE TABLE "availability_intervals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"opened_by_issue_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"release_note" text,
	"released_by_command_id" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_by_command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_issues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"issue_number" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"description" text,
	"safety_critical" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"dismissed_reason" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_by_command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"work_order_number" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"operational_issue_id" uuid,
	"description" text NOT NULL,
	"expected_cost_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'XAF' NOT NULL,
	"status" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"completion_notes" text,
	"resolve_linked_issue" boolean,
	"actual_cost_minor" bigint,
	"completed_by_principal_id" uuid,
	"rejected_reason" text,
	"cancelled_reason" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_by_command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "default_safety_critical" boolean;--> statement-breakpoint
ALTER TABLE "financial_postings" ADD COLUMN "work_order_id" uuid;--> statement-breakpoint
ALTER TABLE "availability_intervals" ADD CONSTRAINT "availability_intervals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_intervals" ADD CONSTRAINT "availability_intervals_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_intervals" ADD CONSTRAINT "availability_intervals_opened_by_issue_id_operational_issues_id_fk" FOREIGN KEY ("opened_by_issue_id") REFERENCES "public"."operational_issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_intervals" ADD CONSTRAINT "availability_intervals_released_by_command_id_commands_id_fk" FOREIGN KEY ("released_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_intervals" ADD CONSTRAINT "availability_intervals_created_by_command_id_commands_id_fk" FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_issues" ADD CONSTRAINT "operational_issues_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_issues" ADD CONSTRAINT "operational_issues_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_issues" ADD CONSTRAINT "operational_issues_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_issues" ADD CONSTRAINT "operational_issues_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_issues" ADD CONSTRAINT "operational_issues_created_by_command_id_commands_id_fk" FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_operational_issue_id_operational_issues_id_fk" FOREIGN KEY ("operational_issue_id") REFERENCES "public"."operational_issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_completed_by_principal_id_principals_id_fk" FOREIGN KEY ("completed_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_command_id_commands_id_fk" FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "availability_intervals_open_per_asset_uq" ON "availability_intervals" USING btree ("workspace_id","asset_id") WHERE "availability_intervals"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "availability_intervals_ws_asset_started_idx" ON "availability_intervals" USING btree ("workspace_id","asset_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_issues_ws_number_uq" ON "operational_issues" USING btree ("workspace_id","issue_number");--> statement-breakpoint
CREATE INDEX "operational_issues_ws_asset_reported_idx" ON "operational_issues" USING btree ("workspace_id","asset_id","reported_at");--> statement-breakpoint
CREATE INDEX "operational_issues_ws_status_idx" ON "operational_issues" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_ws_number_uq" ON "work_orders" USING btree ("workspace_id","work_order_number");--> statement-breakpoint
CREATE INDEX "work_orders_ws_asset_opened_idx" ON "work_orders" USING btree ("workspace_id","asset_id","opened_at");--> statement-breakpoint
CREATE INDEX "work_orders_ws_status_idx" ON "work_orders" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "work_orders_ws_issue_idx" ON "work_orders" USING btree ("workspace_id","operational_issue_id");--> statement-breakpoint
ALTER TABLE "financial_postings" ADD CONSTRAINT "financial_postings_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_postings_ws_work_order_idx" ON "financial_postings" USING btree ("workspace_id","work_order_id");