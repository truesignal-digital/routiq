CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"activity_number" text NOT NULL,
	"activity_type_id" uuid NOT NULL,
	"template_code" text NOT NULL,
	"template_version" integer DEFAULT 1 NOT NULL,
	"custom_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"completeness" text,
	"completeness_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"customer_name" text,
	"client_reference" text,
	"description" text,
	"planned_start_at" timestamp with time zone,
	"planned_end_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by_command_id" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_by_command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_asset_segments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"role" text NOT NULL,
	"substitutes_segment_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"start_reading_id" uuid,
	"end_reading_id" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_by_command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_people" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_by_command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meter_readings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"reading_type" text NOT NULL,
	"value" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"activity_id" uuid,
	"superseded_by_id" uuid,
	"supersede_reason" text,
	"created_by_command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movement_legs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"segment_id" uuid,
	"leg_no" integer NOT NULL,
	"origin_place_id" uuid,
	"origin_text" text,
	"destination_place_id" uuid,
	"destination_text" text,
	"departed_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"distance_km" integer,
	"load_state" text,
	"passenger_count" integer,
	"custom_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"person_code" text,
	"phone" text,
	"default_role" text,
	"membership_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_by_command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"place_type" text,
	"active" boolean DEFAULT true NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_by_command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_postings" ADD COLUMN "activity_id" uuid;--> statement-breakpoint
ALTER TABLE "financial_postings" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "financial_postings" ADD COLUMN "activity_attribution" text DEFAULT 'DIRECT' NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_activity_type_id_categories_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_closed_by_command_id_commands_id_fk" FOREIGN KEY ("closed_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_created_by_command_id_commands_id_fk" FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_asset_segments" ADD CONSTRAINT "activity_asset_segments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_asset_segments" ADD CONSTRAINT "activity_asset_segments_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_asset_segments" ADD CONSTRAINT "activity_asset_segments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_asset_segments" ADD CONSTRAINT "activity_asset_segments_substitutes_segment_id_activity_asset_segments_id_fk" FOREIGN KEY ("substitutes_segment_id") REFERENCES "public"."activity_asset_segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_asset_segments" ADD CONSTRAINT "activity_asset_segments_start_reading_id_meter_readings_id_fk" FOREIGN KEY ("start_reading_id") REFERENCES "public"."meter_readings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_asset_segments" ADD CONSTRAINT "activity_asset_segments_end_reading_id_meter_readings_id_fk" FOREIGN KEY ("end_reading_id") REFERENCES "public"."meter_readings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_asset_segments" ADD CONSTRAINT "activity_asset_segments_created_by_command_id_commands_id_fk" FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_people" ADD CONSTRAINT "activity_people_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_people" ADD CONSTRAINT "activity_people_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_people" ADD CONSTRAINT "activity_people_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_people" ADD CONSTRAINT "activity_people_created_by_command_id_commands_id_fk" FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_superseded_by_id_meter_readings_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."meter_readings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_created_by_command_id_commands_id_fk" FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_legs" ADD CONSTRAINT "movement_legs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_legs" ADD CONSTRAINT "movement_legs_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_legs" ADD CONSTRAINT "movement_legs_segment_id_activity_asset_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."activity_asset_segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_legs" ADD CONSTRAINT "movement_legs_origin_place_id_places_id_fk" FOREIGN KEY ("origin_place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_legs" ADD CONSTRAINT "movement_legs_destination_place_id_places_id_fk" FOREIGN KEY ("destination_place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_legs" ADD CONSTRAINT "movement_legs_created_by_command_id_commands_id_fk" FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_created_by_command_id_commands_id_fk" FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_created_by_command_id_commands_id_fk" FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activities_ws_number_uq" ON "activities" USING btree ("workspace_id","activity_number");--> statement-breakpoint
CREATE INDEX "activities_ws_branch_started_idx" ON "activities" USING btree ("workspace_id","branch_id","started_at");--> statement-breakpoint
CREATE INDEX "activities_ws_status_idx" ON "activities" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "activity_segments_ws_activity_idx" ON "activity_asset_segments" USING btree ("workspace_id","activity_id");--> statement-breakpoint
CREATE INDEX "activity_segments_ws_asset_started_idx" ON "activity_asset_segments" USING btree ("workspace_id","asset_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_people_activity_person_role_uq" ON "activity_people" USING btree ("activity_id","person_id","role");--> statement-breakpoint
CREATE INDEX "activity_people_ws_person_idx" ON "activity_people" USING btree ("workspace_id","person_id");--> statement-breakpoint
CREATE INDEX "meter_readings_ws_asset_observed_idx" ON "meter_readings" USING btree ("workspace_id","asset_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meter_readings_superseded_uq" ON "meter_readings" USING btree ("superseded_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "movement_legs_activity_leg_uq" ON "movement_legs" USING btree ("activity_id","leg_no");--> statement-breakpoint
CREATE INDEX "movement_legs_ws_activity_idx" ON "movement_legs" USING btree ("workspace_id","activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "persons_ws_code_uq" ON "persons" USING btree ("workspace_id","person_code");--> statement-breakpoint
CREATE INDEX "persons_ws_branch_idx" ON "persons" USING btree ("workspace_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "places_ws_normalized_uq" ON "places" USING btree ("workspace_id","normalized_name");--> statement-breakpoint
ALTER TABLE "financial_postings" ADD CONSTRAINT "financial_postings_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_postings" ADD CONSTRAINT "financial_postings_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_postings_ws_activity_idx" ON "financial_postings" USING btree ("workspace_id","activity_id");--> statement-breakpoint
CREATE INDEX "financial_postings_ws_person_idx" ON "financial_postings" USING btree ("workspace_id","person_id");