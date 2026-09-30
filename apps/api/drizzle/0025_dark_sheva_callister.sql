-- Maintenance module (§5.1): operational issues (Signalement), work orders, and
-- asset availability intervals — plus the `work_order_id` attribution column
-- financial_postings has been reserving for this spec (§4.2), so labour and
-- parts costs attach to the work order that incurred them.
--
-- Follows the M1 table conventions established in 0004 and extended in 0014 and
-- 0015: composite FK targets, composite tenant FKs so a cross-tenant reference
-- is structurally impossible, RLS with FORCE, and explicit runtime grants
-- (ALTER DEFAULT PRIVILEGES is deliberately not configured).
--
-- Every statement is idempotent. CREATE TABLE / CREATE INDEX / ADD COLUMN carry
-- IF NOT EXISTS; ADD CONSTRAINT and CREATE POLICY have no such spelling in
-- Postgres, so each sits behind a guarded DO block in the shape 0004 uses for
-- the runtime role. migration-replay.test.ts re-applies this file against a
-- database that already holds it, and must find no work to do.

CREATE TABLE IF NOT EXISTS "operational_issues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"description" text NOT NULL,
	"safety_critical" boolean NOT NULL,
	"category" text,
	"reported_at" timestamp with time zone NOT NULL,
	"created_by_command_id" uuid NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"issue_id" uuid,
	"description" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"expected_cost_minor" bigint,
	"currency" char(3) DEFAULT 'XAF' NOT NULL,
	"actual_cost_minor" bigint,
	"summary" text,
	"cancel_reason" text,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by_command_id" uuid NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_availability_intervals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"opened_by_issue_id" uuid NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_command_id" uuid,
	"created_by_command_id" uuid NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_postings" ADD COLUMN IF NOT EXISTS "work_order_id" uuid;

--> statement-breakpoint

-- Composite FK targets (§4.4 layer 3)

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'operational_issues_ws_id_uq'
      AND conrelid = 'operational_issues'::regclass
  ) THEN
    ALTER TABLE operational_issues
      ADD CONSTRAINT operational_issues_ws_id_uq UNIQUE (workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'work_orders_ws_id_uq'
      AND conrelid = 'work_orders'::regclass
  ) THEN
    ALTER TABLE work_orders
      ADD CONSTRAINT work_orders_ws_id_uq UNIQUE (workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

-- Single-column FKs, as drizzle-kit derives them from the `.references()` calls
-- in schema.ts. The composite tenant FKs below subsume them; both are kept so
-- the database matches the generated snapshot, exactly as every table since
-- 0009 does.
--
-- The guards compare against left(name, 63) because three of these derived
-- names are longer than that — `asset_availability_intervals` plus a long
-- column name overruns Postgres's 63-byte identifier limit, and the server
-- truncates silently on creation. Matching the untruncated name would find
-- nothing on a replay and then fail adding a constraint that already exists.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = left('operational_issues_workspace_id_workspaces_id_fk', 63)
      AND conrelid = 'operational_issues'::regclass
  ) THEN
    ALTER TABLE "operational_issues"
      ADD CONSTRAINT "operational_issues_workspace_id_workspaces_id_fk"
      FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = left('operational_issues_asset_id_assets_id_fk', 63)
      AND conrelid = 'operational_issues'::regclass
  ) THEN
    ALTER TABLE "operational_issues"
      ADD CONSTRAINT "operational_issues_asset_id_assets_id_fk"
      FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = left('operational_issues_created_by_command_id_commands_id_fk', 63)
      AND conrelid = 'operational_issues'::regclass
  ) THEN
    ALTER TABLE "operational_issues"
      ADD CONSTRAINT "operational_issues_created_by_command_id_commands_id_fk"
      FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = left('work_orders_workspace_id_workspaces_id_fk', 63)
      AND conrelid = 'work_orders'::regclass
  ) THEN
    ALTER TABLE "work_orders"
      ADD CONSTRAINT "work_orders_workspace_id_workspaces_id_fk"
      FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = left('work_orders_asset_id_assets_id_fk', 63)
      AND conrelid = 'work_orders'::regclass
  ) THEN
    ALTER TABLE "work_orders"
      ADD CONSTRAINT "work_orders_asset_id_assets_id_fk"
      FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = left('work_orders_issue_id_operational_issues_id_fk', 63)
      AND conrelid = 'work_orders'::regclass
  ) THEN
    ALTER TABLE "work_orders"
      ADD CONSTRAINT "work_orders_issue_id_operational_issues_id_fk"
      FOREIGN KEY ("issue_id") REFERENCES "public"."operational_issues"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = left('work_orders_created_by_command_id_commands_id_fk', 63)
      AND conrelid = 'work_orders'::regclass
  ) THEN
    ALTER TABLE "work_orders"
      ADD CONSTRAINT "work_orders_created_by_command_id_commands_id_fk"
      FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = left('asset_availability_intervals_workspace_id_workspaces_id_fk', 63)
      AND conrelid = 'asset_availability_intervals'::regclass
  ) THEN
    ALTER TABLE "asset_availability_intervals"
      ADD CONSTRAINT "asset_availability_intervals_workspace_id_workspaces_id_fk"
      FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = left('asset_availability_intervals_asset_id_assets_id_fk', 63)
      AND conrelid = 'asset_availability_intervals'::regclass
  ) THEN
    ALTER TABLE "asset_availability_intervals"
      ADD CONSTRAINT "asset_availability_intervals_asset_id_assets_id_fk"
      FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = left('asset_availability_intervals_opened_by_issue_id_operational_issues_id_fk', 63)
      AND conrelid = 'asset_availability_intervals'::regclass
  ) THEN
    ALTER TABLE "asset_availability_intervals"
      ADD CONSTRAINT "asset_availability_intervals_opened_by_issue_id_operational_issues_id_fk"
      FOREIGN KEY ("opened_by_issue_id") REFERENCES "public"."operational_issues"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = left('asset_availability_intervals_closed_by_command_id_commands_id_fk', 63)
      AND conrelid = 'asset_availability_intervals'::regclass
  ) THEN
    ALTER TABLE "asset_availability_intervals"
      ADD CONSTRAINT "asset_availability_intervals_closed_by_command_id_commands_id_fk"
      FOREIGN KEY ("closed_by_command_id") REFERENCES "public"."commands"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = left('asset_availability_intervals_created_by_command_id_commands_id_fk', 63)
      AND conrelid = 'asset_availability_intervals'::regclass
  ) THEN
    ALTER TABLE "asset_availability_intervals"
      ADD CONSTRAINT "asset_availability_intervals_created_by_command_id_commands_id_fk"
      FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = left('financial_postings_work_order_id_work_orders_id_fk', 63)
      AND conrelid = 'financial_postings'::regclass
  ) THEN
    ALTER TABLE "financial_postings"
      ADD CONSTRAINT "financial_postings_work_order_id_work_orders_id_fk"
      FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

-- Cross-tenant references are structurally impossible: every FK carries the
-- workspace, so a row can only ever point at a sibling in its own tenant.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'operational_issues_ws_asset_fk'
      AND conrelid = 'operational_issues'::regclass
  ) THEN
    ALTER TABLE operational_issues
      ADD CONSTRAINT operational_issues_ws_asset_fk
      FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'operational_issues_ws_command_fk'
      AND conrelid = 'operational_issues'::regclass
  ) THEN
    ALTER TABLE operational_issues
      ADD CONSTRAINT operational_issues_ws_command_fk
      FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'work_orders_ws_asset_fk'
      AND conrelid = 'work_orders'::regclass
  ) THEN
    ALTER TABLE work_orders
      ADD CONSTRAINT work_orders_ws_asset_fk
      FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

-- `issue_id` is nullable — a preventive work order has no originating
-- signalement. A NULL component satisfies a composite FK vacuously, so the
-- constraint still bites on every work order that does cite one.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'work_orders_ws_issue_fk'
      AND conrelid = 'work_orders'::regclass
  ) THEN
    ALTER TABLE work_orders
      ADD CONSTRAINT work_orders_ws_issue_fk
      FOREIGN KEY (workspace_id, issue_id) REFERENCES operational_issues(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'work_orders_ws_command_fk'
      AND conrelid = 'work_orders'::regclass
  ) THEN
    ALTER TABLE work_orders
      ADD CONSTRAINT work_orders_ws_command_fk
      FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'asset_availability_intervals_ws_asset_fk'
      AND conrelid = 'asset_availability_intervals'::regclass
  ) THEN
    ALTER TABLE asset_availability_intervals
      ADD CONSTRAINT asset_availability_intervals_ws_asset_fk
      FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'asset_availability_intervals_ws_issue_fk'
      AND conrelid = 'asset_availability_intervals'::regclass
  ) THEN
    ALTER TABLE asset_availability_intervals
      ADD CONSTRAINT asset_availability_intervals_ws_issue_fk
      FOREIGN KEY (workspace_id, opened_by_issue_id) REFERENCES operational_issues(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'asset_availability_intervals_ws_created_command_fk'
      AND conrelid = 'asset_availability_intervals'::regclass
  ) THEN
    ALTER TABLE asset_availability_intervals
      ADD CONSTRAINT asset_availability_intervals_ws_created_command_fk
      FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

-- `closed_by_command_id` stays NULL until release-asset-to-service closes the
-- interval; the composite FK tolerates that and constrains the release command
-- to the same tenant once it is written.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'asset_availability_intervals_ws_closed_command_fk'
      AND conrelid = 'asset_availability_intervals'::regclass
  ) THEN
    ALTER TABLE asset_availability_intervals
      ADD CONSTRAINT asset_availability_intervals_ws_closed_command_fk
      FOREIGN KEY (workspace_id, closed_by_command_id) REFERENCES commands(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'financial_postings_ws_work_order_fk'
      AND conrelid = 'financial_postings'::regclass
  ) THEN
    ALTER TABLE financial_postings
      ADD CONSTRAINT financial_postings_ws_work_order_fk
      FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "operational_issues_ws_asset_idx" ON "operational_issues" USING btree ("workspace_id","asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_orders_ws_asset_idx" ON "work_orders" USING btree ("workspace_id","asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_orders_ws_status_idx" ON "work_orders" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_availability_intervals_ws_asset_idx" ON "asset_availability_intervals" USING btree ("workspace_id","asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_postings_ws_work_order_idx" ON "financial_postings" USING btree ("workspace_id","work_order_id");

--> statement-breakpoint

-- An asset is UNAVAILABLE exactly while it holds an open interval, so at most
-- one may be open at a time. The partial unique index is what makes that a
-- structural fact rather than a handler convention.
CREATE UNIQUE INDEX IF NOT EXISTS "asset_availability_intervals_open_per_asset_uq" ON "asset_availability_intervals" USING btree ("workspace_id","asset_id") WHERE "asset_availability_intervals"."closed_at" IS NULL;

--> statement-breakpoint

-- Enable RLS on operational_issues
ALTER TABLE operational_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_issues FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'operational_issues'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON operational_issues
      USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
      WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
  END IF;
END $$;

--> statement-breakpoint

-- Enable RLS on work_orders
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'work_orders'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON work_orders
      USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
      WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
  END IF;
END $$;

--> statement-breakpoint

-- Enable RLS on asset_availability_intervals
ALTER TABLE asset_availability_intervals ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_availability_intervals FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'asset_availability_intervals'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON asset_availability_intervals
      USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
      WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
  END IF;
END $$;

--> statement-breakpoint

-- 0014 set the rule: a new posting column must join the immutability guard's
-- ROW comparison, or it is silently mutable through the one UPDATE path
-- postings still allow (the period assignment at approval time).
CREATE OR REPLACE FUNCTION guard_financial_posting_update() RETURNS trigger AS $$
BEGIN
  IF ROW(
    NEW.id, NEW.workspace_id, NEW.financial_entry_id, NEW.line_no,
    NEW.economic_date, NEW.direction, NEW.category_id, NEW.branch_id,
    NEW.asset_id, NEW.activity_id, NEW.work_order_id, NEW.person_id,
    NEW.amount_minor, NEW.asset_attribution, NEW.activity_attribution,
    NEW.created_by_command_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.workspace_id, OLD.financial_entry_id, OLD.line_no,
    OLD.economic_date, OLD.direction, OLD.category_id, OLD.branch_id,
    OLD.asset_id, OLD.activity_id, OLD.work_order_id, OLD.person_id,
    OLD.amount_minor, OLD.asset_attribution, OLD.activity_attribution,
    OLD.created_by_command_id, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'financial postings are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.posting_period_id IS NOT NULL OR NEW.posting_period_id IS NULL THEN
    RAISE EXCEPTION 'posting period may be assigned exactly once'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

-- Runtime grants (§4.4 layer 1). New tables get nothing by default — the
-- ALL TABLES grant in 0004 covered only the tables that existed then, and
-- default privileges are deliberately not configured — so each privilege below
-- is the whole of what routiq_app may do. DELETE is granted to none of them:
-- these rows are corrected by superseding commands, never removed.

-- A signalement is an append-only fact: it records what someone observed, and a
-- later observation is a new issue rather than an edit of the old one.
GRANT SELECT, INSERT ON operational_issues TO routiq_app;

--> statement-breakpoint

-- Work orders carry a status that moves (OPEN → PENDING_CLOSE → CLOSED, or
-- CANCELLED), so UPDATE is the transition path; cancellation stamps a reason
-- rather than deleting the row.
GRANT SELECT, INSERT, UPDATE ON work_orders TO routiq_app;

--> statement-breakpoint

-- An interval is opened by report-issue and closed — never deleted — by
-- release-asset-to-service, which writes closed_at and closed_by_command_id.
GRANT SELECT, INSERT, UPDATE ON asset_availability_intervals TO routiq_app;
