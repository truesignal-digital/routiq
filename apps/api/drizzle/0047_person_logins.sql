-- A Person gets a login through link-person-login, and loses it through
-- unlink-person-login (#569, ADR-0010).
--
--   persons.membership_id   the current link (column since 0013, composite
--                           tenant FK since 0030). Now unique per workspace:
--                           one login belongs to one person.
--   person_logins           every link, one row per period. A link is ended,
--                           never rewritten, so who held which login, and
--                           from when to when, stays on record.
--
-- Table conventions as in 0043: composite tenant FKs, RLS with FORCE, explicit
-- grants. Every statement is idempotent, so migration-replay.test.ts can
-- re-apply the file if it is ever renumbered.

CREATE TABLE IF NOT EXISTS "person_logins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"created_by_command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_by_command_id" uuid,
	"ended_at" timestamp with time zone
);

--> statement-breakpoint

-- Single-column FKs, as drizzle-kit derives them from schema.ts; the composite
-- tenant FKs below subsume them, and both are kept so the database matches the
-- generated snapshot.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'person_logins_workspace_id_workspaces_id_fk'
      AND conrelid = 'person_logins'::regclass
  ) THEN
    ALTER TABLE "person_logins" ADD CONSTRAINT "person_logins_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'person_logins_person_id_persons_id_fk'
      AND conrelid = 'person_logins'::regclass
  ) THEN
    ALTER TABLE "person_logins" ADD CONSTRAINT "person_logins_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'person_logins_membership_id_memberships_id_fk'
      AND conrelid = 'person_logins'::regclass
  ) THEN
    ALTER TABLE "person_logins" ADD CONSTRAINT "person_logins_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'person_logins_created_by_command_id_commands_id_fk'
      AND conrelid = 'person_logins'::regclass
  ) THEN
    ALTER TABLE "person_logins" ADD CONSTRAINT "person_logins_created_by_command_id_commands_id_fk" FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'person_logins_ended_by_command_id_commands_id_fk'
      AND conrelid = 'person_logins'::regclass
  ) THEN
    ALTER TABLE "person_logins" ADD CONSTRAINT "person_logins_ended_by_command_id_commands_id_fk" FOREIGN KEY ("ended_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

-- At most one open link per person and per login.
CREATE UNIQUE INDEX IF NOT EXISTS "person_logins_open_person_uq" ON "person_logins" USING btree ("workspace_id","person_id") WHERE "person_logins"."ended_at" is null;

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "person_logins_open_membership_uq" ON "person_logins" USING btree ("workspace_id","membership_id") WHERE "person_logins"."ended_at" is null;

--> statement-breakpoint

-- No command has set persons.membership_id before this migration, so no
-- existing row can break the new index.
CREATE UNIQUE INDEX IF NOT EXISTS "persons_ws_membership_uq" ON "persons" USING btree ("workspace_id","membership_id") WHERE "persons"."membership_id" is not null;

--> statement-breakpoint

-- An ended link says who ended it, and an open one says nothing about it.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'person_logins_ended_ck'
      AND conrelid = 'person_logins'::regclass
  ) THEN
    ALTER TABLE person_logins
      ADD CONSTRAINT person_logins_ended_ck
      CHECK ((ended_at IS NULL) = (ended_by_command_id IS NULL));
  END IF;
END $$;

--> statement-breakpoint

-- Composite tenant FKs (§4.4 layer 3): a link can only name a person, a login
-- and commands of its own workspace.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'person_logins_ws_person_fk'
      AND conrelid = 'person_logins'::regclass
  ) THEN
    ALTER TABLE person_logins
      ADD CONSTRAINT person_logins_ws_person_fk
      FOREIGN KEY (workspace_id, person_id) REFERENCES persons(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'person_logins_ws_membership_fk'
      AND conrelid = 'person_logins'::regclass
  ) THEN
    ALTER TABLE person_logins
      ADD CONSTRAINT person_logins_ws_membership_fk
      FOREIGN KEY (workspace_id, membership_id) REFERENCES memberships(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'person_logins_ws_command_fk'
      AND conrelid = 'person_logins'::regclass
  ) THEN
    ALTER TABLE person_logins
      ADD CONSTRAINT person_logins_ws_command_fk
      FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'person_logins_ws_ended_by_command_fk'
      AND conrelid = 'person_logins'::regclass
  ) THEN
    ALTER TABLE person_logins
      ADD CONSTRAINT person_logins_ws_ended_by_command_fk
      FOREIGN KEY (workspace_id, ended_by_command_id) REFERENCES commands(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

ALTER TABLE person_logins ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_logins FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'person_logins'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON person_logins
      USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
      WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
  END IF;
END $$;

--> statement-breakpoint

-- Runtime grants (§4.4 layer 1): read, append, and end a link. Who, which
-- login and since when never change once written.
GRANT SELECT, INSERT ON person_logins TO routiq_app;
GRANT UPDATE (ended_at, ended_by_command_id) ON person_logins TO routiq_app;

--> statement-breakpoint

-- Approval defaults for both commands, for workspaces that predate them (a
-- new workspace gets the same rows from provisioning/packs/core.ts). No
-- matching rule means APPROVAL_REQUIRED. The member administrators run them;
-- the handler narrows ADMIN to the logins it may manage. Idempotent: NOT
-- EXISTS per workspace, command and role.
INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT w.id, c.command_type, NULL, NULL, NULL, NULL, r.required_role
FROM workspaces w
CROSS JOIN (VALUES ('link-person-login'), ('unlink-person-login')) AS c(command_type)
CROSS JOIN (VALUES ('DIRECTOR'), ('ADMIN')) AS r(required_role)
WHERE NOT EXISTS (
  SELECT 1 FROM approval_rules ar
  WHERE ar.workspace_id = w.id
    AND ar.command_type = c.command_type
    AND ar.required_role = r.required_role
);
