CREATE TABLE "financial_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entry_number" text NOT NULL,
	"direction" text NOT NULL,
	"category_id" uuid NOT NULL,
	"economic_date" date NOT NULL,
	"posting_period_id" uuid,
	"is_late_posting" boolean DEFAULT false NOT NULL,
	"branch_id" uuid NOT NULL,
	"counterparty_name" text,
	"description" text,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'XAF' NOT NULL,
	"payment_method" text NOT NULL,
	"payment_reference" text,
	"source_reference" text,
	"estimate_status" text DEFAULT 'ACTUAL' NOT NULL,
	"status" text NOT NULL,
	"rejected_reason" text,
	"reverses_entry_id" uuid,
	"posted_at" timestamp with time zone,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_by_command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"financial_entry_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"economic_date" date NOT NULL,
	"posting_period_id" uuid,
	"direction" text NOT NULL,
	"category_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"asset_id" uuid,
	"amount_minor" bigint NOT NULL,
	"asset_attribution" text DEFAULT 'DIRECT' NOT NULL,
	"created_by_command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_counters" (
	"workspace_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "number_counters_workspace_id_scope_pk" PRIMARY KEY("workspace_id","scope")
);
--> statement-breakpoint
CREATE TABLE "posting_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"period_code" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by_command_id" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_by_command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "profitability_layer" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "evidence_policy" text DEFAULT 'RECEIPT_EXPECTED' NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_posting_period_id_posting_periods_id_fk" FOREIGN KEY ("posting_period_id") REFERENCES "public"."posting_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_reverses_entry_id_financial_entries_id_fk" FOREIGN KEY ("reverses_entry_id") REFERENCES "public"."financial_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_created_by_command_id_commands_id_fk" FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_postings" ADD CONSTRAINT "financial_postings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_postings" ADD CONSTRAINT "financial_postings_financial_entry_id_financial_entries_id_fk" FOREIGN KEY ("financial_entry_id") REFERENCES "public"."financial_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_postings" ADD CONSTRAINT "financial_postings_posting_period_id_posting_periods_id_fk" FOREIGN KEY ("posting_period_id") REFERENCES "public"."posting_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_postings" ADD CONSTRAINT "financial_postings_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_postings" ADD CONSTRAINT "financial_postings_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_postings" ADD CONSTRAINT "financial_postings_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_postings" ADD CONSTRAINT "financial_postings_created_by_command_id_commands_id_fk" FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_counters" ADD CONSTRAINT "number_counters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_periods" ADD CONSTRAINT "posting_periods_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_periods" ADD CONSTRAINT "posting_periods_locked_by_command_id_commands_id_fk" FOREIGN KEY ("locked_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_periods" ADD CONSTRAINT "posting_periods_created_by_command_id_commands_id_fk" FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_entries_ws_number_uq" ON "financial_entries" USING btree ("workspace_id","entry_number");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_entries_reverses_uq" ON "financial_entries" USING btree ("workspace_id","reverses_entry_id");--> statement-breakpoint
CREATE INDEX "financial_entries_ws_period_idx" ON "financial_entries" USING btree ("workspace_id","posting_period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_postings_entry_line_uq" ON "financial_postings" USING btree ("financial_entry_id","line_no");--> statement-breakpoint
CREATE INDEX "financial_postings_ws_asset_date_idx" ON "financial_postings" USING btree ("workspace_id","asset_id","economic_date");--> statement-breakpoint
CREATE INDEX "financial_postings_ws_period_idx" ON "financial_postings" USING btree ("workspace_id","posting_period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "posting_periods_ws_code_uq" ON "posting_periods" USING btree ("workspace_id","period_code");