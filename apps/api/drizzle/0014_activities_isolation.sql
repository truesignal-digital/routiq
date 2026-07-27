-- Activities: tenant isolation, carrier-overlap exclusion, append-only meter
-- readings, runtime grants. Follows the M1 conventions established in 0004 and
-- extended for finance in 0010.

-- Composite FK targets (§4.4 layer 3)
ALTER TABLE persons ADD CONSTRAINT persons_ws_id_uq UNIQUE (workspace_id, id);

--> statement-breakpoint

ALTER TABLE places ADD CONSTRAINT places_ws_id_uq UNIQUE (workspace_id, id);

--> statement-breakpoint

ALTER TABLE activities ADD CONSTRAINT activities_ws_id_uq UNIQUE (workspace_id, id);

--> statement-breakpoint

ALTER TABLE activity_asset_segments
  ADD CONSTRAINT activity_asset_segments_ws_id_uq UNIQUE (workspace_id, id);

--> statement-breakpoint

ALTER TABLE meter_readings ADD CONSTRAINT meter_readings_ws_id_uq UNIQUE (workspace_id, id);

--> statement-breakpoint

-- Cross-tenant references are structurally impossible: every FK carries the
-- workspace, so a row can only ever point at a sibling in its own tenant.

ALTER TABLE persons
  ADD CONSTRAINT persons_ws_branch_fk
  FOREIGN KEY (workspace_id, branch_id) REFERENCES branches(workspace_id, id);

--> statement-breakpoint

ALTER TABLE activities
  ADD CONSTRAINT activities_ws_branch_fk
  FOREIGN KEY (workspace_id, branch_id) REFERENCES branches(workspace_id, id);

--> statement-breakpoint

ALTER TABLE activities
  ADD CONSTRAINT activities_ws_type_fk
  FOREIGN KEY (workspace_id, activity_type_id) REFERENCES categories(workspace_id, id);

--> statement-breakpoint

ALTER TABLE activity_asset_segments
  ADD CONSTRAINT activity_segments_ws_activity_fk
  FOREIGN KEY (workspace_id, activity_id) REFERENCES activities(workspace_id, id);

--> statement-breakpoint

ALTER TABLE activity_asset_segments
  ADD CONSTRAINT activity_segments_ws_asset_fk
  FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id);

--> statement-breakpoint

ALTER TABLE activity_asset_segments
  ADD CONSTRAINT activity_segments_ws_substitutes_fk
  FOREIGN KEY (workspace_id, substitutes_segment_id)
  REFERENCES activity_asset_segments(workspace_id, id);

--> statement-breakpoint

ALTER TABLE activity_people
  ADD CONSTRAINT activity_people_ws_activity_fk
  FOREIGN KEY (workspace_id, activity_id) REFERENCES activities(workspace_id, id);

--> statement-breakpoint

ALTER TABLE activity_people
  ADD CONSTRAINT activity_people_ws_person_fk
  FOREIGN KEY (workspace_id, person_id) REFERENCES persons(workspace_id, id);

--> statement-breakpoint

ALTER TABLE movement_legs
  ADD CONSTRAINT movement_legs_ws_activity_fk
  FOREIGN KEY (workspace_id, activity_id) REFERENCES activities(workspace_id, id);

--> statement-breakpoint

ALTER TABLE movement_legs
  ADD CONSTRAINT movement_legs_ws_segment_fk
  FOREIGN KEY (workspace_id, segment_id) REFERENCES activity_asset_segments(workspace_id, id);

--> statement-breakpoint

ALTER TABLE movement_legs
  ADD CONSTRAINT movement_legs_ws_origin_fk
  FOREIGN KEY (workspace_id, origin_place_id) REFERENCES places(workspace_id, id);

--> statement-breakpoint

ALTER TABLE movement_legs
  ADD CONSTRAINT movement_legs_ws_destination_fk
  FOREIGN KEY (workspace_id, destination_place_id) REFERENCES places(workspace_id, id);

--> statement-breakpoint

ALTER TABLE meter_readings
  ADD CONSTRAINT meter_readings_ws_asset_fk
  FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id);

--> statement-breakpoint

ALTER TABLE meter_readings
  ADD CONSTRAINT meter_readings_ws_activity_fk
  FOREIGN KEY (workspace_id, activity_id) REFERENCES activities(workspace_id, id);

--> statement-breakpoint

ALTER TABLE meter_readings
  ADD CONSTRAINT meter_readings_ws_superseded_fk
  FOREIGN KEY (workspace_id, superseded_by_id) REFERENCES meter_readings(workspace_id, id);

--> statement-breakpoint

ALTER TABLE activity_asset_segments
  ADD CONSTRAINT activity_segments_ws_start_reading_fk
  FOREIGN KEY (workspace_id, start_reading_id) REFERENCES meter_readings(workspace_id, id);

--> statement-breakpoint

ALTER TABLE activity_asset_segments
  ADD CONSTRAINT activity_segments_ws_end_reading_fk
  FOREIGN KEY (workspace_id, end_reading_id) REFERENCES meter_readings(workspace_id, id);

--> statement-breakpoint

-- The new posting attribution dimensions carry the tenant too.

ALTER TABLE financial_postings
  ADD CONSTRAINT financial_postings_ws_activity_fk
  FOREIGN KEY (workspace_id, activity_id) REFERENCES activities(workspace_id, id);

--> statement-breakpoint

ALTER TABLE financial_postings
  ADD CONSTRAINT financial_postings_ws_person_fk
  FOREIGN KEY (workspace_id, person_id) REFERENCES persons(workspace_id, id);

--> statement-breakpoint

-- Structural backstops only (§4.3): cheap CHECKs the command layer also enforces.

ALTER TABLE activities
  ADD CONSTRAINT activities_completeness_ck
  CHECK ((status = 'CLOSED') = (completeness IS NOT NULL));

--> statement-breakpoint

ALTER TABLE activities
  ADD CONSTRAINT activities_complete_has_no_codes_ck
  CHECK (completeness IS DISTINCT FROM 'COMPLETE' OR cardinality(completeness_codes) = 0);

--> statement-breakpoint

ALTER TABLE activity_asset_segments
  ADD CONSTRAINT activity_segments_interval_ck
  CHECK (ended_at IS NULL OR ended_at > started_at);

--> statement-breakpoint

-- §3.1: a place reference OR free text for ad-hoc stops — but never neither.
ALTER TABLE movement_legs
  ADD CONSTRAINT movement_legs_origin_ck
  CHECK (origin_place_id IS NOT NULL OR origin_text IS NOT NULL);

--> statement-breakpoint

ALTER TABLE movement_legs
  ADD CONSTRAINT movement_legs_destination_ck
  CHECK (destination_place_id IS NOT NULL OR destination_text IS NOT NULL);

--> statement-breakpoint

-- §3.2: exactly one carrier at any moment. PRIMARY and SUBSTITUTE are both
-- carrier roles differing only in provenance, so the predicate must cover both --
-- constraining PRIMARY alone would let a substitute open while the original is
-- still running and leave two concurrent carriers. TRAILER and RECOVERY are
-- concurrent by design and stay outside it.
--
-- btree_gist supplies the `=` operator class for activity_id inside a gist index.
-- An open segment has ended_at NULL -> unbounded upper bound, so it blocks any
-- replacement until the handover is recorded. `[)` bounds let [t0,h) and [h,inf)
-- abut without overlapping; because exclusion constraints are checked per
-- statement and substitution closes the outgoing segment before inserting the
-- incoming one, no DEFERRABLE is needed.
CREATE EXTENSION IF NOT EXISTS btree_gist;

--> statement-breakpoint

ALTER TABLE activity_asset_segments
  ADD CONSTRAINT activity_segments_carrier_no_overlap
  EXCLUDE USING gist (
    activity_id WITH =,
    tstzrange(started_at, ended_at, '[)') WITH &&
  ) WHERE (role IN ('PRIMARY', 'SUBSTITUTE'));

--> statement-breakpoint

-- Tenant isolation (§4.4 layer 2)

ALTER TABLE persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE persons FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON persons
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

ALTER TABLE places ENABLE ROW LEVEL SECURITY;
ALTER TABLE places FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON places
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON activities
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

ALTER TABLE activity_asset_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_asset_segments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON activity_asset_segments
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

ALTER TABLE activity_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_people FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON activity_people
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

ALTER TABLE movement_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE movement_legs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON movement_legs
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

ALTER TABLE meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meter_readings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meter_readings
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

-- The new posting columns must join the immutability guard's ROW comparison, or
-- they are silently mutable through the one UPDATE path postings still allow.
CREATE OR REPLACE FUNCTION guard_financial_posting_update() RETURNS trigger AS $$
BEGIN
  IF ROW(
    NEW.id, NEW.workspace_id, NEW.financial_entry_id, NEW.line_no,
    NEW.economic_date, NEW.direction, NEW.category_id, NEW.branch_id,
    NEW.asset_id, NEW.activity_id, NEW.person_id,
    NEW.amount_minor, NEW.asset_attribution, NEW.activity_attribution,
    NEW.created_by_command_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.workspace_id, OLD.financial_entry_id, OLD.line_no,
    OLD.economic_date, OLD.direction, OLD.category_id, OLD.branch_id,
    OLD.asset_id, OLD.activity_id, OLD.person_id,
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

-- Runtime grants (§4.4 layer 1)

GRANT SELECT, INSERT, UPDATE, DELETE ON
  persons, places, activities, activity_asset_segments,
  activity_people, movement_legs, meter_readings
  TO routiq_app;

--> statement-breakpoint

-- §3.1: readings are immutable observations; a correction inserts a new row and
-- points superseded_by_id at it. The runtime keeps UPDATE on that one column so
-- the supersede link can be written, and nothing else.
REVOKE UPDATE, DELETE ON meter_readings FROM routiq_app;

--> statement-breakpoint

GRANT UPDATE (superseded_by_id, supersede_reason) ON meter_readings TO routiq_app;

--> statement-breakpoint

-- Crew rows and legs are corrected by superseding commands, never deleted.
REVOKE DELETE ON activity_people, movement_legs FROM routiq_app;
