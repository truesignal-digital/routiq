-- Planned trips share the trip record (ADR-0012, #334). A booking is an
-- activities row in a first status, PLANNED; starting it turns the same row
-- OPEN; calling it off before it starts makes it CANCELLED.
--
--   status            PLANNED | OPEN | CLOSED | CANCELLED, now with a CHECK.
--                     The default stays OPEN, so create-activity and the
--                     sheets write what they wrote before.
--   planned_*         the plan (vehicle, driver, route), never the facts:
--                     segments and crew rows are still written only at start.
--   agreed_price_minor, amount_to_collect_minor
--                     integer minor units of price_currency (XAF, exponent 0).
--                     A booking never writes an entry or a posting.
--   cancelled_*, cancellation_*
--                     kept if a late offline start revives the trip.
--   discrepancy_codes permanent facts written by start-planned-trip.
--
-- Existing rows need no backfill: every one is OPEN or CLOSED and every writer
-- set started_at. If a row breaks a CHECK, the migration fails as a whole and
-- that row has to be looked at; nothing is guessed.
--
-- Every statement is re-appliable (migration-replay.test.ts), since another
-- branch may want the same number.

ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "planned_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "planned_driver_person_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "planned_origin_place_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "planned_origin_text" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "planned_destination_place_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "planned_destination_text" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "agreed_price_minor" bigint;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "amount_to_collect_minor" bigint;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "price_currency" char(3) DEFAULT 'XAF' NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "cancelled_by_command_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "cancellation_note" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "discrepancy_codes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint

-- Single-column FKs, as drizzle-kit derives them from schema.ts; the composite
-- tenant FKs further down subsume them, and both are kept so the database
-- matches the generated snapshot.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'activities_planned_asset_id_assets_id_fk' AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE "activities" ADD CONSTRAINT "activities_planned_asset_id_assets_id_fk"
      FOREIGN KEY ("planned_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'activities_planned_driver_person_id_persons_id_fk' AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE "activities" ADD CONSTRAINT "activities_planned_driver_person_id_persons_id_fk"
      FOREIGN KEY ("planned_driver_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'activities_planned_origin_place_id_places_id_fk' AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE "activities" ADD CONSTRAINT "activities_planned_origin_place_id_places_id_fk"
      FOREIGN KEY ("planned_origin_place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'activities_planned_destination_place_id_places_id_fk' AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE "activities" ADD CONSTRAINT "activities_planned_destination_place_id_places_id_fk"
      FOREIGN KEY ("planned_destination_place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'activities_cancelled_by_command_id_commands_id_fk' AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE "activities" ADD CONSTRAINT "activities_cancelled_by_command_id_commands_id_fk"
      FOREIGN KEY ("cancelled_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

-- Composite tenant FKs (§4.4 layer 3): a trip can only plan a vehicle, driver,
-- place or cancelling command of its own workspace.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'activities_ws_planned_asset_fk' AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE activities ADD CONSTRAINT activities_ws_planned_asset_fk
      FOREIGN KEY (workspace_id, planned_asset_id) REFERENCES assets(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'activities_ws_planned_driver_fk' AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE activities ADD CONSTRAINT activities_ws_planned_driver_fk
      FOREIGN KEY (workspace_id, planned_driver_person_id) REFERENCES persons(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'activities_ws_planned_origin_fk' AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE activities ADD CONSTRAINT activities_ws_planned_origin_fk
      FOREIGN KEY (workspace_id, planned_origin_place_id) REFERENCES places(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'activities_ws_planned_destination_fk' AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE activities ADD CONSTRAINT activities_ws_planned_destination_fk
      FOREIGN KEY (workspace_id, planned_destination_place_id) REFERENCES places(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'activities_ws_cancelled_by_command_fk' AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE activities ADD CONSTRAINT activities_ws_cancelled_by_command_fk
      FOREIGN KEY (workspace_id, cancelled_by_command_id) REFERENCES commands(workspace_id, id);
  END IF;
END $$;

--> statement-breakpoint

-- What each status requires (ADR-0012 §1). One DO block, so a replay that
-- finds them all present adds nothing.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint WHERE conname = 'activities_status_ck' AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE activities ADD CONSTRAINT activities_status_ck
      CHECK (status IN ('PLANNED', 'OPEN', 'CLOSED', 'CANCELLED'));
  END IF;

  -- A planned or cancelled trip has no actual start; a started one always has one.
  IF NOT EXISTS (
    SELECT FROM pg_constraint WHERE conname = 'activities_started_at_ck' AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE activities ADD CONSTRAINT activities_started_at_ck
      CHECK ((status IN ('PLANNED', 'CANCELLED')) = (started_at IS NULL));
  END IF;

  IF NOT EXISTS (
    SELECT FROM pg_constraint WHERE conname = 'activities_planned_start_ck' AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE activities ADD CONSTRAINT activities_planned_start_ck
      CHECK (status <> 'PLANNED' OR planned_start_at IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT FROM pg_constraint WHERE conname = 'activities_planned_window_ck' AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE activities ADD CONSTRAINT activities_planned_window_ck
      CHECK (planned_end_at IS NULL OR planned_end_at > planned_start_at);
  END IF;

  IF NOT EXISTS (
    SELECT FROM pg_constraint WHERE conname = 'activities_price_ck' AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE activities ADD CONSTRAINT activities_price_ck
      CHECK (
        (agreed_price_minor IS NULL OR agreed_price_minor >= 0)
        AND (amount_to_collect_minor IS NULL OR amount_to_collect_minor >= 0)
      );
  END IF;

  IF NOT EXISTS (
    SELECT FROM pg_constraint WHERE conname = 'activities_cancellation_ck' AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE activities ADD CONSTRAINT activities_cancellation_ck
      CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL));
  END IF;

  IF NOT EXISTS (
    SELECT FROM pg_constraint WHERE conname = 'activities_cancellation_reason_ck' AND conrelid = 'activities'::regclass
  ) THEN
    ALTER TABLE activities ADD CONSTRAINT activities_cancellation_reason_ck
      CHECK (
        cancellation_reason IS NULL
        OR (
          cancellation_reason IN ('CUSTOMER_CANCELLED', 'NO_VEHICLE_OR_DRIVER', 'BOOKED_TWICE', 'OTHER')
          AND (cancellation_reason <> 'OTHER' OR cancellation_note IS NOT NULL)
        )
      );
  END IF;
END $$;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "activities_ws_branch_planned_idx" ON "activities" USING btree ("workspace_id","branch_id","planned_start_at") WHERE "activities"."status" IN ('PLANNED', 'OPEN');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_ws_planned_asset_idx" ON "activities" USING btree ("workspace_id","planned_asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_ws_planned_driver_idx" ON "activities" USING btree ("workspace_id","planned_driver_person_id");

--> statement-breakpoint

-- Approval defaults for the six SCHEDULING commands, for workspaces that
-- predate them (a new workspace gets the same rows from
-- provisioning/packs/core.ts). No matching rule means APPROVAL_REQUIRED.
-- Booking edits are DIRECTOR and ADMIN; a driver may also start their own
-- trip. Idempotent: NOT EXISTS per workspace, command and role.
INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT w.id, r.command_type, NULL, NULL, NULL, NULL, r.required_role
FROM workspaces w
CROSS JOIN (
  VALUES
    ('plan-trip', 'DIRECTOR'), ('plan-trip', 'ADMIN'),
    ('assign-trip', 'DIRECTOR'), ('assign-trip', 'ADMIN'),
    ('reschedule-trip', 'DIRECTOR'), ('reschedule-trip', 'ADMIN'),
    ('update-planned-trip', 'DIRECTOR'), ('update-planned-trip', 'ADMIN'),
    ('cancel-planned-trip', 'DIRECTOR'), ('cancel-planned-trip', 'ADMIN'),
    ('start-planned-trip', 'DIRECTOR'), ('start-planned-trip', 'ADMIN'),
    ('start-planned-trip', 'DRIVER')
) AS r(command_type, required_role)
WHERE NOT EXISTS (
  SELECT 1 FROM approval_rules ar
  WHERE ar.workspace_id = w.id
    AND ar.command_type = r.command_type
    AND ar.required_role = r.required_role
);
