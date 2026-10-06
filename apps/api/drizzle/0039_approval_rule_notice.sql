-- Tell members when the approval rules change (#422). Two append-only tables:
--
--   approval_rule_changes          one row per change to the entry chain:
--                                  update-approval-threshold writes one beside
--                                  its audit event; this file writes one per
--                                  workspace for the release that changed the
--                                  chain (0038, #412).
--   approval_rule_acknowledgements one row per member who has read a change,
--                                  written by acknowledge-approval-rules.
--
-- A migration writes no command receipt and no audit event, so the 0038 row
-- carries no created_by_command_id: the notice then names ROUTIQ, not a member.
-- Its affected_roles are the two roles 0038 moved, FINANCE and ADMIN.
--
-- M1 table conventions as in 0028: composite tenant FKs, RLS with FORCE,
-- explicit grants (read and append only). Every statement is idempotent, so
-- migration-replay.test.ts can re-apply the file if it is ever renumbered.

CREATE TABLE IF NOT EXISTS "approval_rule_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"affected_roles" text[] NOT NULL,
	"created_by_command_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "approval_rule_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"change_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"created_by_command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

-- Single-column FKs, as drizzle-kit derives them from schema.ts; the composite
-- tenant FKs below subsume them, and both are kept so the database matches the
-- generated snapshot.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'approval_rule_changes_workspace_id_workspaces_id_fk'
      AND conrelid = 'approval_rule_changes'::regclass
  ) THEN
    ALTER TABLE "approval_rule_changes"
      ADD CONSTRAINT "approval_rule_changes_workspace_id_workspaces_id_fk"
      FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'approval_rule_changes_created_by_command_id_commands_id_fk'
      AND conrelid = 'approval_rule_changes'::regclass
  ) THEN
    ALTER TABLE "approval_rule_changes"
      ADD CONSTRAINT "approval_rule_changes_created_by_command_id_commands_id_fk"
      FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'approval_rule_acknowledgements_workspace_id_workspaces_id_fk'
      AND conrelid = 'approval_rule_acknowledgements'::regclass
  ) THEN
    ALTER TABLE "approval_rule_acknowledgements"
      ADD CONSTRAINT "approval_rule_acknowledgements_workspace_id_workspaces_id_fk"
      FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'approval_rule_acknowledgements_change_id_approval_rule_changes_id_fk'
      AND conrelid = 'approval_rule_acknowledgements'::regclass
  ) THEN
    ALTER TABLE "approval_rule_acknowledgements"
      ADD CONSTRAINT "approval_rule_acknowledgements_change_id_approval_rule_changes_id_fk"
      FOREIGN KEY ("change_id") REFERENCES "public"."approval_rule_changes"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'approval_rule_acknowledgements_membership_id_memberships_id_fk'
      AND conrelid = 'approval_rule_acknowledgements'::regclass
  ) THEN
    ALTER TABLE "approval_rule_acknowledgements"
      ADD CONSTRAINT "approval_rule_acknowledgements_membership_id_memberships_id_fk"
      FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'approval_rule_acknowledgements_created_by_command_id_commands_id_fk'
      AND conrelid = 'approval_rule_acknowledgements'::regclass
  ) THEN
    ALTER TABLE "approval_rule_acknowledgements"
      ADD CONSTRAINT "approval_rule_acknowledgements_created_by_command_id_commands_id_fk"
      FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "approval_rule_changes_ws_id_uq" ON "approval_rule_changes" USING btree ("workspace_id","id");

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "approval_rule_changes_ws_changed_idx" ON "approval_rule_changes" USING btree ("workspace_id","changed_at");

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "approval_rule_acknowledgements_ws_member_change_uq" ON "approval_rule_acknowledgements" USING btree ("workspace_id","membership_id","change_id");

--> statement-breakpoint

-- Composite tenant FKs (§4.4 layer 3). A NULL created_by_command_id (the 0038
-- row) satisfies its FK vacuously, which is the point: no receipt exists.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'approval_rule_changes_ws_command_fk'
      AND conrelid = 'approval_rule_changes'::regclass
  ) THEN
    ALTER TABLE "approval_rule_changes"
      ADD CONSTRAINT "approval_rule_changes_ws_command_fk"
      FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'approval_rule_acknowledgements_ws_change_fk'
      AND conrelid = 'approval_rule_acknowledgements'::regclass
  ) THEN
    ALTER TABLE "approval_rule_acknowledgements"
      ADD CONSTRAINT "approval_rule_acknowledgements_ws_change_fk"
      FOREIGN KEY (workspace_id, change_id) REFERENCES approval_rule_changes(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'approval_rule_acknowledgements_ws_member_fk'
      AND conrelid = 'approval_rule_acknowledgements'::regclass
  ) THEN
    ALTER TABLE "approval_rule_acknowledgements"
      ADD CONSTRAINT "approval_rule_acknowledgements_ws_member_fk"
      FOREIGN KEY (workspace_id, membership_id) REFERENCES memberships(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'approval_rule_acknowledgements_ws_command_fk'
      AND conrelid = 'approval_rule_acknowledgements'::regclass
  ) THEN
    ALTER TABLE "approval_rule_acknowledgements"
      ADD CONSTRAINT "approval_rule_acknowledgements_ws_command_fk"
      FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'approval_rule_changes_roles_ck'
      AND conrelid = 'approval_rule_changes'::regclass
  ) THEN
    ALTER TABLE approval_rule_changes
      ADD CONSTRAINT approval_rule_changes_roles_ck CHECK (cardinality(affected_roles) > 0);
  END IF;
END $$;

--> statement-breakpoint

ALTER TABLE approval_rule_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_rule_changes FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'approval_rule_changes'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON approval_rule_changes
      USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
      WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
  END IF;
END $$;

--> statement-breakpoint

ALTER TABLE approval_rule_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_rule_acknowledgements FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'approval_rule_acknowledgements'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON approval_rule_acknowledgements
      USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
      WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
  END IF;
END $$;

--> statement-breakpoint

-- Runtime grants (§4.4 layer 1): read and append. A change is never edited and
-- an acknowledgement never withdrawn.
GRANT SELECT, INSERT ON approval_rule_changes TO routiq_app;
GRANT SELECT, INSERT ON approval_rule_acknowledgements TO routiq_app;

--> statement-breakpoint

-- Approval defaults for acknowledge-approval-rules, for workspaces that predate
-- it (a new workspace gets the same rows from provisioning/packs/core.ts). No
-- matching rule means APPROVAL_REQUIRED, which would 403 every dismissal.
-- Every role may acknowledge. Idempotent: NOT EXISTS per workspace and role.
INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT w.id, 'acknowledge-approval-rules', NULL, NULL, NULL, NULL, r.required_role
FROM workspaces w
CROSS JOIN (
  VALUES ('DIRECTOR'), ('ADMIN'), ('FINANCE'), ('CASHIER'), ('TECHNICIAN'), ('DRIVER')
) AS r(required_role)
WHERE NOT EXISTS (
  SELECT 1 FROM approval_rules ar
  WHERE ar.workspace_id = w.id
    AND ar.command_type = 'acknowledge-approval-rules'
    AND ar.required_role = r.required_role
);

--> statement-breakpoint

-- The change 0038 made: Finance's and the Administrateur's own entries above
-- the recording band now wait for approval. One row per existing workspace;
-- a workspace provisioned later starts on these rules and has nothing to be
-- told. Idempotent: a workspace that already holds a release row gets none.
INSERT INTO approval_rule_changes (workspace_id, affected_roles)
SELECT w.id, ARRAY['FINANCE', 'ADMIN']::text[]
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM approval_rule_changes c
  WHERE c.workspace_id = w.id AND c.created_by_command_id IS NULL
);
