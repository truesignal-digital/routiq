-- Company settings › Dashboard summary (#669): when the summary notice shows
-- on every Overview. One row per workspace, written by set-summary-schedule;
-- no row means the default (every Monday and the 1st of the month), so no
-- backfill is needed.
--
-- Table conventions as in 0047: composite tenant FKs, RLS with FORCE, explicit
-- grants. Every statement is idempotent, so migration-replay.test.ts can
-- re-apply the file if it is ever renumbered.

CREATE TABLE IF NOT EXISTS "company_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"summary_schedule" text DEFAULT 'MONDAY_AND_MONTH_START' NOT NULL,
	"created_by_command_id" uuid NOT NULL,
	"updated_by_command_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);

--> statement-breakpoint

-- Single-column FKs, as drizzle-kit derives them from schema.ts; the composite
-- tenant FKs below subsume the command ones, and both are kept so the
-- database matches the generated snapshot.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'company_settings_workspace_id_workspaces_id_fk'
      AND conrelid = 'company_settings'::regclass
  ) THEN
    ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'company_settings_created_by_command_id_commands_id_fk'
      AND conrelid = 'company_settings'::regclass
  ) THEN
    ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_created_by_command_id_commands_id_fk" FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'company_settings_updated_by_command_id_commands_id_fk'
      AND conrelid = 'company_settings'::regclass
  ) THEN
    ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_updated_by_command_id_commands_id_fk" FOREIGN KEY ("updated_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

-- The four schedules of SUMMARY_SCHEDULES in @routiq/contracts.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'company_settings_summary_schedule_ck'
      AND conrelid = 'company_settings'::regclass
  ) THEN
    ALTER TABLE company_settings
      ADD CONSTRAINT company_settings_summary_schedule_ck
      CHECK (summary_schedule IN ('MONDAY_AND_MONTH_START', 'MONDAY', 'MONTH_START', 'NEVER'));
  END IF;
END $$;

--> statement-breakpoint

-- Composite tenant FKs (§4.4 layer 3): the row names commands of its own
-- workspace only.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'company_settings_ws_created_by_command_fk'
      AND conrelid = 'company_settings'::regclass
  ) THEN
    ALTER TABLE company_settings
      ADD CONSTRAINT company_settings_ws_created_by_command_fk
      FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'company_settings_ws_updated_by_command_fk'
      AND conrelid = 'company_settings'::regclass
  ) THEN
    ALTER TABLE company_settings
      ADD CONSTRAINT company_settings_ws_updated_by_command_fk
      FOREIGN KEY (workspace_id, updated_by_command_id) REFERENCES commands(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_settings FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'company_settings'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON company_settings
      USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
      WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
  END IF;
END $$;

--> statement-breakpoint

-- Runtime grants (§4.4 layer 1): read, insert the first change, update the
-- next ones. Never deleted: a workspace goes back to the default by choosing it.
GRANT SELECT, INSERT, UPDATE ON company_settings TO routiq_app;

--> statement-breakpoint

-- Approval default for the command, for workspaces that predate it (a new
-- workspace gets the same row from provisioning/packs/core.ts). Settings
-- belong to Direction (ADR-0009); no matching rule means APPROVAL_REQUIRED.
-- Idempotent: NOT EXISTS per workspace.
INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT w.id, 'set-summary-schedule', NULL, NULL, NULL, NULL, 'DIRECTOR'
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM approval_rules ar
  WHERE ar.workspace_id = w.id
    AND ar.command_type = 'set-summary-schedule'
    AND ar.required_role = 'DIRECTOR'
);
