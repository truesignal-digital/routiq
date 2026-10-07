-- Direction's notes wait in the vehicle's To-do until someone acknowledges
-- them (#98).
--
--   notes.author_role        the author's role when the note was written, so a
--                            later role change does not move old notes in or
--                            out of the To-do. Existing notes take the role
--                            their author holds now, the best record there is.
--   note_acknowledgements    one append-only row per acknowledged note, written
--                            by acknowledge-note: who saw it and when. The note
--                            itself is never touched.
--
-- Table conventions as in 0039: composite tenant FKs, RLS with FORCE, explicit
-- grants (read and append only). Every statement is idempotent, so
-- migration-replay.test.ts can re-apply the file if it is ever renumbered.

ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "author_role" text;

--> statement-breakpoint

UPDATE notes n
SET author_role = m.role
FROM memberships m
WHERE m.workspace_id = n.workspace_id
  AND m.id = n.author_membership_id
  AND n.author_role IS NULL;

--> statement-breakpoint

ALTER TABLE "notes" ALTER COLUMN "author_role" SET NOT NULL;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'notes_author_role_ck'
      AND conrelid = 'notes'::regclass
  ) THEN
    ALTER TABLE notes
      ADD CONSTRAINT notes_author_role_ck CHECK (
        author_role IN ('DIRECTOR', 'ADMIN', 'FINANCE', 'CASHIER', 'TECHNICIAN', 'DRIVER')
      );
  END IF;
END $$;

--> statement-breakpoint

-- The target of the acknowledgements' composite tenant FK.
CREATE UNIQUE INDEX IF NOT EXISTS "notes_ws_id_uq" ON "notes" USING btree ("workspace_id","id");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "note_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
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
    WHERE conname = 'note_acknowledgements_workspace_id_workspaces_id_fk'
      AND conrelid = 'note_acknowledgements'::regclass
  ) THEN
    ALTER TABLE "note_acknowledgements"
      ADD CONSTRAINT "note_acknowledgements_workspace_id_workspaces_id_fk"
      FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'note_acknowledgements_note_id_notes_id_fk'
      AND conrelid = 'note_acknowledgements'::regclass
  ) THEN
    ALTER TABLE "note_acknowledgements"
      ADD CONSTRAINT "note_acknowledgements_note_id_notes_id_fk"
      FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'note_acknowledgements_membership_id_memberships_id_fk'
      AND conrelid = 'note_acknowledgements'::regclass
  ) THEN
    ALTER TABLE "note_acknowledgements"
      ADD CONSTRAINT "note_acknowledgements_membership_id_memberships_id_fk"
      FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'note_acknowledgements_created_by_command_id_commands_id_fk'
      AND conrelid = 'note_acknowledgements'::regclass
  ) THEN
    ALTER TABLE "note_acknowledgements"
      ADD CONSTRAINT "note_acknowledgements_created_by_command_id_commands_id_fk"
      FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

-- One acknowledgement per note: the first one wins.
CREATE UNIQUE INDEX IF NOT EXISTS "note_acknowledgements_ws_note_uq" ON "note_acknowledgements" USING btree ("workspace_id","note_id");

--> statement-breakpoint

-- Composite tenant FKs (§4.4 layer 3).

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'note_acknowledgements_ws_note_fk'
      AND conrelid = 'note_acknowledgements'::regclass
  ) THEN
    ALTER TABLE "note_acknowledgements"
      ADD CONSTRAINT note_acknowledgements_ws_note_fk
      FOREIGN KEY (workspace_id, note_id) REFERENCES notes(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'note_acknowledgements_ws_member_fk'
      AND conrelid = 'note_acknowledgements'::regclass
  ) THEN
    ALTER TABLE "note_acknowledgements"
      ADD CONSTRAINT note_acknowledgements_ws_member_fk
      FOREIGN KEY (workspace_id, membership_id) REFERENCES memberships(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'note_acknowledgements_ws_command_fk'
      AND conrelid = 'note_acknowledgements'::regclass
  ) THEN
    ALTER TABLE "note_acknowledgements"
      ADD CONSTRAINT note_acknowledgements_ws_command_fk
      FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

ALTER TABLE note_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_acknowledgements FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'note_acknowledgements'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON note_acknowledgements
      USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
      WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
  END IF;
END $$;

--> statement-breakpoint

-- Runtime grants (§4.4 layer 1): read and append. An acknowledgement is never
-- edited or withdrawn.
GRANT SELECT, INSERT ON note_acknowledgements TO routiq_app;

--> statement-breakpoint

-- Approval defaults for acknowledge-note, for workspaces that predate it (a
-- new workspace gets the same rows from provisioning/packs/core.ts). No
-- matching rule means APPROVAL_REQUIRED. Every role may acknowledge.
-- Idempotent: NOT EXISTS per workspace and role.
INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT w.id, 'acknowledge-note', NULL, NULL, NULL, NULL, r.required_role
FROM workspaces w
CROSS JOIN (
  VALUES ('DIRECTOR'), ('ADMIN'), ('FINANCE'), ('CASHIER'), ('TECHNICIAN'), ('DRIVER')
) AS r(required_role)
WHERE NOT EXISTS (
  SELECT 1 FROM approval_rules ar
  WHERE ar.workspace_id = w.id
    AND ar.command_type = 'acknowledge-note'
    AND ar.required_role = r.required_role
);
