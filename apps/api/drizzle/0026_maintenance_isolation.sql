-- Maintenance: tenant isolation, lifecycle CHECKs, posting immutability and
-- runtime grants for operational_issues / work_orders / availability_intervals.
-- Follows the M1 conventions established in 0004 and extended in 0010/0014.

-- Composite FK targets (§4.4 layer 3)
ALTER TABLE operational_issues
  ADD CONSTRAINT operational_issues_ws_id_uq UNIQUE (workspace_id, id);

--> statement-breakpoint

ALTER TABLE work_orders ADD CONSTRAINT work_orders_ws_id_uq UNIQUE (workspace_id, id);

--> statement-breakpoint

ALTER TABLE availability_intervals
  ADD CONSTRAINT availability_intervals_ws_id_uq UNIQUE (workspace_id, id);

--> statement-breakpoint

-- Cross-tenant references are structurally impossible: every FK carries the
-- workspace, so a row can only ever point at a sibling in its own tenant.

ALTER TABLE operational_issues
  ADD CONSTRAINT operational_issues_ws_branch_fk
  FOREIGN KEY (workspace_id, branch_id) REFERENCES branches(workspace_id, id);

--> statement-breakpoint

ALTER TABLE operational_issues
  ADD CONSTRAINT operational_issues_ws_asset_fk
  FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id);

--> statement-breakpoint

ALTER TABLE operational_issues
  ADD CONSTRAINT operational_issues_ws_category_fk
  FOREIGN KEY (workspace_id, category_id) REFERENCES categories(workspace_id, id);

--> statement-breakpoint

ALTER TABLE operational_issues
  ADD CONSTRAINT operational_issues_ws_command_fk
  FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);

--> statement-breakpoint

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_ws_branch_fk
  FOREIGN KEY (workspace_id, branch_id) REFERENCES branches(workspace_id, id);

--> statement-breakpoint

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_ws_asset_fk
  FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id);

--> statement-breakpoint

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_ws_issue_fk
  FOREIGN KEY (workspace_id, operational_issue_id)
  REFERENCES operational_issues(workspace_id, id);

--> statement-breakpoint

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_ws_command_fk
  FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);

--> statement-breakpoint

ALTER TABLE availability_intervals
  ADD CONSTRAINT availability_intervals_ws_asset_fk
  FOREIGN KEY (workspace_id, asset_id) REFERENCES assets(workspace_id, id);

--> statement-breakpoint

ALTER TABLE availability_intervals
  ADD CONSTRAINT availability_intervals_ws_issue_fk
  FOREIGN KEY (workspace_id, opened_by_issue_id)
  REFERENCES operational_issues(workspace_id, id);

--> statement-breakpoint

ALTER TABLE availability_intervals
  ADD CONSTRAINT availability_intervals_ws_released_command_fk
  FOREIGN KEY (workspace_id, released_by_command_id) REFERENCES commands(workspace_id, id);

--> statement-breakpoint

ALTER TABLE availability_intervals
  ADD CONSTRAINT availability_intervals_ws_command_fk
  FOREIGN KEY (workspace_id, created_by_command_id) REFERENCES commands(workspace_id, id);

--> statement-breakpoint

-- The new posting attribution dimension carries the tenant too.
ALTER TABLE financial_postings
  ADD CONSTRAINT financial_postings_ws_work_order_fk
  FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders(workspace_id, id);

--> statement-breakpoint

-- Structural backstops only (§4.3): cheap CHECKs the command layer also enforces.

-- The safety-critical default is issue-category configuration; other kinds
-- carry NULL so the column cannot silently grow a second meaning.
ALTER TABLE categories
  ADD CONSTRAINT categories_issue_safety_default_ck
  CHECK (default_safety_critical IS NULL OR kind = 'ISSUE_TYPE');

--> statement-breakpoint

ALTER TABLE operational_issues
  ADD CONSTRAINT operational_issues_resolved_ck
  CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL));

--> statement-breakpoint

ALTER TABLE operational_issues
  ADD CONSTRAINT operational_issues_dismissed_ck
  CHECK ((status = 'DISMISSED') = (dismissed_reason IS NOT NULL));

--> statement-breakpoint

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_expected_cost_ck
  CHECK (expected_cost_minor >= 0);

--> statement-breakpoint

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_rejected_ck
  CHECK ((status = 'REJECTED') = (rejected_reason IS NOT NULL));

--> statement-breakpoint

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_cancelled_ck
  CHECK ((status = 'CANCELLED') = (cancelled_reason IS NOT NULL));

--> statement-breakpoint

-- Completion facts travel as one unit: a WO cannot sit in a completion state
-- without the facts the gate matched on. One-directional — a completion
-- rejection nulls the facts on the way back to APPROVED, and a cancellation
-- from COMPLETION_SUBMITTED may keep them as the record of what was pending.
ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_completion_facts_ck
  CHECK (
    status NOT IN ('COMPLETION_SUBMITTED', 'COMPLETED')
    OR (
      completed_at IS NOT NULL
      AND actual_cost_minor IS NOT NULL
      AND completed_by_principal_id IS NOT NULL
    )
  );

--> statement-breakpoint

ALTER TABLE availability_intervals
  ADD CONSTRAINT availability_intervals_interval_ck
  CHECK (ended_at IS NULL OR ended_at > started_at);

--> statement-breakpoint

-- An interval is closed exactly by the release command that decided it.
ALTER TABLE availability_intervals
  ADD CONSTRAINT availability_intervals_release_ck
  CHECK ((ended_at IS NULL) = (released_by_command_id IS NULL));

--> statement-breakpoint

-- The new posting column must join the immutability guard's ROW comparison, or
-- it is silently mutable through the one UPDATE path postings still allow.
CREATE OR REPLACE FUNCTION guard_financial_posting_update() RETURNS trigger AS $$
BEGIN
  IF ROW(
    NEW.id, NEW.workspace_id, NEW.financial_entry_id, NEW.line_no,
    NEW.economic_date, NEW.direction, NEW.category_id, NEW.branch_id,
    NEW.asset_id, NEW.activity_id, NEW.person_id, NEW.work_order_id,
    NEW.amount_minor, NEW.asset_attribution, NEW.activity_attribution,
    NEW.created_by_command_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.workspace_id, OLD.financial_entry_id, OLD.line_no,
    OLD.economic_date, OLD.direction, OLD.category_id, OLD.branch_id,
    OLD.asset_id, OLD.activity_id, OLD.person_id, OLD.work_order_id,
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

-- Tenant isolation (§4.4 layer 2)

ALTER TABLE operational_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_issues FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON operational_issues
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON work_orders
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

ALTER TABLE availability_intervals ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_intervals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON availability_intervals
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

-- Runtime grants (§4.4 layer 1). Status transitions are the only edits after
-- insert, so UPDATE stays granted; nothing in maintenance is ever deleted —
-- issues are dismissed, WOs cancelled, intervals closed.
GRANT SELECT, INSERT, UPDATE ON
  operational_issues, work_orders, availability_intervals
  TO routiq_app;
