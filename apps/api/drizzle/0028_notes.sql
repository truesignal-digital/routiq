-- Notes (#44): a free-text annotation on a record, written by `add-note.v1`.
-- Append-only — SELECT and INSERT are all the runtime role gets, so a
-- correction is another note. v1 annotates assets only.
--
-- M1 table conventions as in 0025: composite tenant FKs so a cross-tenant
-- reference is structurally impossible, RLS with FORCE, explicit grants.
-- `entity_type`/`entity_id` name the target generically; `asset_id` is the
-- exclusive arc the composite FK hangs off, tied to `entity_id` by a CHECK, so
-- the generic pair can never point where the FK does not.
--
-- Every statement is idempotent, like 0025–0027: migration-replay.test.ts
-- re-applies this file against a database that already holds it.

CREATE TABLE IF NOT EXISTS "notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"asset_id" uuid,
	"author_membership_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_by_command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

-- Single-column FKs, as drizzle-kit derives them from schema.ts; the composite
-- tenant FKs below subsume them, and both are kept so the database matches the
-- generated snapshot, as every table since 0009 does.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'notes_workspace_id_workspaces_id_fk'
      AND conrelid = 'notes'::regclass
  ) THEN
    ALTER TABLE "notes"
      ADD CONSTRAINT "notes_workspace_id_workspaces_id_fk"
      FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'notes_asset_id_assets_id_fk'
      AND conrelid = 'notes'::regclass
  ) THEN
    ALTER TABLE "notes"
      ADD CONSTRAINT "notes_asset_id_assets_id_fk"
      FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'notes_author_membership_id_memberships_id_fk'
      AND conrelid = 'notes'::regclass
  ) THEN
    ALTER TABLE "notes"
      ADD CONSTRAINT "notes_author_membership_id_memberships_id_fk"
      FOREIGN KEY ("author_membership_id") REFERENCES "public"."memberships"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'notes_created_by_command_id_commands_id_fk'
      AND conrelid = 'notes'::regclass
  ) THEN
    ALTER TABLE "notes"
      ADD CONSTRAINT "notes_created_by_command_id_commands_id_fk"
      FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

-- Composite tenant FKs (§4.4 layer 3). `asset_id` is NULL only for a target
-- type that does not exist yet; a NULL component satisfies a composite FK
-- vacuously, which is why the arc CHECK below insists on it for assets.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'notes_ws_asset_fk'
      AND conrelid = 'notes'::regclass
  ) THEN
    ALTER TABLE notes
      ADD CONSTRAINT notes_ws_asset_fk
      FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'notes_ws_author_fk'
      AND conrelid = 'notes'::regclass
  ) THEN
    ALTER TABLE notes
      ADD CONSTRAINT notes_ws_author_fk
      FOREIGN KEY (workspace_id, author_membership_id) REFERENCES memberships(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'notes_ws_command_fk'
      AND conrelid = 'notes'::regclass
  ) THEN
    ALTER TABLE notes
      ADD CONSTRAINT notes_ws_command_fk
      FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

-- The target vocabulary, and the exclusive arc: an asset note carries its
-- asset in `asset_id`, and in `asset_id` only. `IS NOT NULL` is spelled out
-- because `asset_id = entity_id` is unknown — and so passes a CHECK — when
-- `asset_id` is NULL.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'notes_entity_type_ck'
      AND conrelid = 'notes'::regclass
  ) THEN
    ALTER TABLE notes
      ADD CONSTRAINT notes_entity_type_ck CHECK (entity_type IN ('asset'));
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'notes_asset_arc_ck'
      AND conrelid = 'notes'::regclass
  ) THEN
    ALTER TABLE notes
      ADD CONSTRAINT notes_asset_arc_ck CHECK (
        entity_type <> 'asset' OR (asset_id IS NOT NULL AND asset_id = entity_id)
      );
  END IF;
END $$;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "notes_ws_entity_created_idx" ON "notes" USING btree ("workspace_id","entity_type","entity_id","created_at");

--> statement-breakpoint

-- The vehicle history and attention reads walk a vehicle's documents; nothing
-- indexed them by asset before.
CREATE INDEX IF NOT EXISTS "documents_ws_asset_idx" ON "documents" USING btree ("workspace_id","asset_id");

--> statement-breakpoint

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notes'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON notes
      USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
      WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
  END IF;
END $$;

--> statement-breakpoint

-- Runtime grants (§4.4 layer 1): read and append, nothing else. No UPDATE — a
-- note is never edited; no DELETE — a regretted note is answered by another.
GRANT SELECT, INSERT ON notes TO routiq_app;

--> statement-breakpoint

-- Approval defaults for add-note, for workspaces that predate it (a new
-- workspace gets the same rows from provisioning/packs/core.ts;
-- vehicle-workspace.migration.test.ts holds the two copies together). No
-- matching rule means APPROVAL_REQUIRED, which would 403 every note.
--
--   add-note: ADMIN, OPS_MANAGER, FIELD_SUBMITTER, MAINTENANCE, FINANCE_APPROVER
--   (EXECUTIVE_VIEWER records nothing.)
--
-- Idempotent: NOT EXISTS per workspace, command type and role.
INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT
  w.id,
  c.command_type,
  NULL,
  NULL,
  NULL,
  NULL,
  c.required_role
FROM workspaces w
CROSS JOIN (
  VALUES
    ('add-note', 'ADMIN'),
    ('add-note', 'OPS_MANAGER'),
    ('add-note', 'FIELD_SUBMITTER'),
    ('add-note', 'MAINTENANCE'),
    ('add-note', 'FINANCE_APPROVER')
) AS c(command_type, required_role)
WHERE NOT EXISTS (
  SELECT 1
  FROM approval_rules r
  WHERE r.workspace_id = w.id
    AND r.command_type = c.command_type
    AND r.required_role = c.required_role
);
