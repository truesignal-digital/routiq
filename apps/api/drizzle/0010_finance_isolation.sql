-- Financial core: tenant isolation, period-lock trigger, append-only enforcement,
-- runtime grants (per M1 conventions in 0004).

-- Composite FK targets
ALTER TABLE posting_periods ADD CONSTRAINT posting_periods_ws_id_uq UNIQUE (workspace_id, id);

--> statement-breakpoint

ALTER TABLE financial_entries ADD CONSTRAINT financial_entries_ws_id_uq UNIQUE (workspace_id, id);

--> statement-breakpoint
-- (categories_ws_id_uq already exists from the documents migration)

-- Cross-tenant references are structurally impossible (§4.4 layer 3)
ALTER TABLE financial_entries
  ADD CONSTRAINT financial_entries_ws_category_fk
  FOREIGN KEY (workspace_id, category_id)
  REFERENCES categories(workspace_id, id);

--> statement-breakpoint

ALTER TABLE financial_entries
  ADD CONSTRAINT financial_entries_ws_branch_fk
  FOREIGN KEY (workspace_id, branch_id)
  REFERENCES branches(workspace_id, id);

--> statement-breakpoint

ALTER TABLE financial_entries
  ADD CONSTRAINT financial_entries_ws_period_fk
  FOREIGN KEY (workspace_id, posting_period_id)
  REFERENCES posting_periods(workspace_id, id);

--> statement-breakpoint

ALTER TABLE financial_entries
  ADD CONSTRAINT financial_entries_ws_command_fk
  FOREIGN KEY (workspace_id, created_by_command_id)
  REFERENCES commands(workspace_id, id);

--> statement-breakpoint

ALTER TABLE financial_entries
  ADD CONSTRAINT financial_entries_ws_reverses_fk
  FOREIGN KEY (workspace_id, reverses_entry_id)
  REFERENCES financial_entries(workspace_id, id);

--> statement-breakpoint

ALTER TABLE financial_postings
  ADD CONSTRAINT financial_postings_ws_entry_fk
  FOREIGN KEY (workspace_id, financial_entry_id)
  REFERENCES financial_entries(workspace_id, id);

--> statement-breakpoint

ALTER TABLE financial_postings
  ADD CONSTRAINT financial_postings_ws_category_fk
  FOREIGN KEY (workspace_id, category_id)
  REFERENCES categories(workspace_id, id);

--> statement-breakpoint

ALTER TABLE financial_postings
  ADD CONSTRAINT financial_postings_ws_branch_fk
  FOREIGN KEY (workspace_id, branch_id)
  REFERENCES branches(workspace_id, id);

--> statement-breakpoint

ALTER TABLE financial_postings
  ADD CONSTRAINT financial_postings_ws_asset_fk
  FOREIGN KEY (workspace_id, asset_id)
  REFERENCES assets(workspace_id, id);

--> statement-breakpoint

ALTER TABLE financial_postings
  ADD CONSTRAINT financial_postings_ws_period_fk
  FOREIGN KEY (workspace_id, posting_period_id)
  REFERENCES posting_periods(workspace_id, id);

--> statement-breakpoint

ALTER TABLE financial_postings
  ADD CONSTRAINT financial_postings_ws_command_fk
  FOREIGN KEY (workspace_id, created_by_command_id)
  REFERENCES commands(workspace_id, id);

--> statement-breakpoint

ALTER TABLE posting_periods
  ADD CONSTRAINT posting_periods_ws_command_fk
  FOREIGN KEY (workspace_id, created_by_command_id)
  REFERENCES commands(workspace_id, id);

--> statement-breakpoint

ALTER TABLE posting_periods
  ADD CONSTRAINT posting_periods_ws_locked_command_fk
  FOREIGN KEY (workspace_id, locked_by_command_id)
  REFERENCES commands(workspace_id, id);

--> statement-breakpoint

-- Backfill known presets before enforcing the layer rule. Existing custom
-- financial categories are deliberately not assigned a made-up layer; the
-- NOT VALID constraint below allows the upgrade while requiring the next edit
-- to classify them explicitly.
INSERT INTO categories (
  workspace_id, kind, code, label_fr, label_en,
  profitability_layer, evidence_policy, active
)
SELECT
  w.id,
  preset.kind,
  preset.code,
  preset.label_fr,
  preset.label_en,
  preset.profitability_layer,
  preset.evidence_policy,
  true
FROM workspaces w
CROSS JOIN (
  VALUES
    ('EXPENSE_CATEGORY', 'FUEL', 'Carburant', 'Fuel', 'DIRECT', 'RECEIPT_EXPECTED'),
    ('EXPENSE_CATEGORY', 'REPAIRS', 'Réparations', 'Repairs', 'MAINTENANCE', 'RECEIPT_EXPECTED'),
    ('EXPENSE_CATEGORY', 'INSURANCE', 'Assurance', 'Insurance', 'OWNERSHIP', 'RECEIPT_EXPECTED'),
    ('EXPENSE_CATEGORY', 'PARKING', 'Stationnement', 'Parking', 'DIRECT', 'NO_RECEIPT_EXPECTED'),
    ('EXPENSE_CATEGORY', 'LOADING', 'Chargement', 'Loading', 'DIRECT', 'NO_RECEIPT_EXPECTED'),
    ('REVENUE_CATEGORY', 'FREIGHT_REVENUE', 'Recettes de fret', 'Freight revenue', 'DIRECT', 'RECEIPT_EXPECTED'),
    ('REVENUE_CATEGORY', 'TICKET_REVENUE', 'Recettes de billetterie', 'Ticket revenue', 'DIRECT', 'RECEIPT_EXPECTED')
) AS preset(kind, code, label_fr, label_en, profitability_layer, evidence_policy)
ON CONFLICT (workspace_id, kind, code) DO UPDATE
SET
  profitability_layer = COALESCE(
    categories.profitability_layer,
    EXCLUDED.profitability_layer
  ),
  evidence_policy = COALESCE(
    categories.evidence_policy,
    EXCLUDED.evidence_policy
  );

--> statement-breakpoint

-- Preserve unknown legacy categories without inventing a profitability layer,
-- but quarantine them from new postings until an operator classifies and
-- explicitly reactivates them.
UPDATE categories
SET active = false
WHERE kind IN ('REVENUE_CATEGORY', 'EXPENSE_CATEGORY')
  AND profitability_layer IS NULL;

--> statement-breakpoint

-- Financial categories must carry a profitability layer (§4.2); others must not.
ALTER TABLE categories
  ADD CONSTRAINT categories_profitability_layer_ck
  CHECK (
    (kind IN ('REVENUE_CATEGORY', 'EXPENSE_CATEGORY')) = (profitability_layer IS NOT NULL)
  ) NOT VALID;

--> statement-breakpoint

ALTER TABLE categories
  ADD CONSTRAINT categories_profitability_layer_value_ck
  CHECK (
    profitability_layer IS NULL OR
    profitability_layer IN ('DIRECT', 'MAINTENANCE', 'OWNERSHIP', 'SHARED')
  );

--> statement-breakpoint

ALTER TABLE categories
  ADD CONSTRAINT categories_evidence_policy_ck
  CHECK (evidence_policy IN ('RECEIPT_EXPECTED', 'NO_RECEIPT_EXPECTED'));

--> statement-breakpoint

ALTER TABLE posting_periods
  ADD CONSTRAINT posting_periods_code_ck
  CHECK (period_code ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

--> statement-breakpoint

ALTER TABLE posting_periods
  ADD CONSTRAINT posting_periods_status_ck
  CHECK (status IN ('OPEN', 'LOCKED'));

--> statement-breakpoint

ALTER TABLE financial_entries
  ADD CONSTRAINT financial_entries_direction_ck
  CHECK (direction IN ('REVENUE', 'EXPENSE'));

--> statement-breakpoint

ALTER TABLE financial_entries
  ADD CONSTRAINT financial_entries_amount_nonzero_ck
  CHECK (amount_minor <> 0);

--> statement-breakpoint

ALTER TABLE financial_entries
  ADD CONSTRAINT financial_entries_currency_ck
  CHECK (char_length(currency) = 3 AND currency = 'XAF');

--> statement-breakpoint

ALTER TABLE financial_entries
  ADD CONSTRAINT financial_entries_payment_method_ck
  CHECK (payment_method IN ('CASH', 'MOMO', 'OM', 'BANK', 'OTHER'));

--> statement-breakpoint

ALTER TABLE financial_entries
  ADD CONSTRAINT financial_entries_estimate_status_ck
  CHECK (estimate_status IN ('ACTUAL', 'ESTIMATED'));

--> statement-breakpoint

ALTER TABLE financial_entries
  ADD CONSTRAINT financial_entries_status_ck
  CHECK (status IN ('SUBMITTED', 'POSTED', 'REJECTED', 'REVERSED'));

--> statement-breakpoint

ALTER TABLE financial_postings
  ADD CONSTRAINT financial_postings_direction_ck
  CHECK (direction IN ('REVENUE', 'EXPENSE'));

--> statement-breakpoint

ALTER TABLE financial_postings
  ADD CONSTRAINT financial_postings_asset_attribution_ck
  CHECK (asset_attribution IN ('DIRECT', 'ALLOCATED'));

--> statement-breakpoint

-- Zero-amount postings are meaningless and would let empty reversal rows slip through.
ALTER TABLE financial_postings
  ADD CONSTRAINT financial_postings_amount_nonzero_ck CHECK (amount_minor <> 0);

--> statement-breakpoint

-- RLS (§4.4 layer 2)
ALTER TABLE posting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE posting_periods FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON posting_periods
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

ALTER TABLE financial_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON financial_entries
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

ALTER TABLE financial_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_postings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON financial_postings
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

ALTER TABLE number_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE number_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON number_counters
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

--> statement-breakpoint

-- The one period-lock trigger (§4.3): structural backstop only — the command
-- layer never targets a locked period.
CREATE OR REPLACE FUNCTION reject_locked_period() RETURNS trigger AS $$
BEGIN
  IF NEW.posting_period_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM posting_periods p
    WHERE p.id = NEW.posting_period_id AND p.status = 'LOCKED'
  ) THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: posting period % is locked', NEW.posting_period_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

CREATE TRIGGER financial_entries_period_lock
  BEFORE INSERT OR UPDATE OF posting_period_id ON financial_entries
  FOR EACH ROW EXECUTE FUNCTION reject_locked_period();

--> statement-breakpoint

CREATE TRIGGER financial_postings_period_lock
  BEFORE INSERT OR UPDATE OF posting_period_id ON financial_postings
  FOR EACH ROW EXECUTE FUNCTION reject_locked_period();

--> statement-breakpoint

-- Entry economic facts are append-only. Approval/rejection/reversal may update
-- only lifecycle fields, and period/posted fields may be assigned once.
CREATE OR REPLACE FUNCTION guard_financial_entry_update() RETURNS trigger AS $$
BEGIN
  IF ROW(
    NEW.workspace_id, NEW.entry_number, NEW.direction, NEW.category_id,
    NEW.economic_date, NEW.branch_id, NEW.counterparty_name, NEW.description,
    NEW.amount_minor, NEW.currency, NEW.payment_method, NEW.payment_reference,
    NEW.source_reference, NEW.estimate_status, NEW.reverses_entry_id,
    NEW.created_by_command_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.workspace_id, OLD.entry_number, OLD.direction, OLD.category_id,
    OLD.economic_date, OLD.branch_id, OLD.counterparty_name, OLD.description,
    OLD.amount_minor, OLD.currency, OLD.payment_method, OLD.payment_reference,
    OLD.source_reference, OLD.estimate_status, OLD.reverses_entry_id,
    OLD.created_by_command_id, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'financial entry economic facts are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.posting_period_id IS NOT NULL
     AND NEW.posting_period_id IS DISTINCT FROM OLD.posting_period_id THEN
    RAISE EXCEPTION 'financial entry posting period is immutable once assigned'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.posted_at IS NOT NULL AND NEW.posted_at IS DISTINCT FROM OLD.posted_at THEN
    RAISE EXCEPTION 'financial entry posted_at is immutable once assigned'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.is_late_posting IS DISTINCT FROM OLD.is_late_posting
     AND NOT (OLD.posting_period_id IS NULL AND NEW.posting_period_id IS NOT NULL) THEN
    RAISE EXCEPTION 'late-posting flag may change only during initial posting'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

CREATE TRIGGER financial_entries_immutable_facts
  BEFORE UPDATE ON financial_entries
  FOR EACH ROW EXECUTE FUNCTION guard_financial_entry_update();

--> statement-breakpoint

-- Submitted posting lines receive their period exactly once at approval. All
-- other posting fields, and any later attempt to move the period, are blocked.
CREATE OR REPLACE FUNCTION guard_financial_posting_update() RETURNS trigger AS $$
BEGIN
  IF ROW(
    NEW.id, NEW.workspace_id, NEW.financial_entry_id, NEW.line_no,
    NEW.economic_date, NEW.direction, NEW.category_id, NEW.branch_id,
    NEW.asset_id, NEW.amount_minor, NEW.asset_attribution,
    NEW.created_by_command_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.workspace_id, OLD.financial_entry_id, OLD.line_no,
    OLD.economic_date, OLD.direction, OLD.category_id, OLD.branch_id,
    OLD.asset_id, OLD.amount_minor, OLD.asset_attribution,
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

CREATE TRIGGER financial_postings_immutable
  BEFORE UPDATE ON financial_postings
  FOR EACH ROW EXECUTE FUNCTION guard_financial_posting_update();

--> statement-breakpoint

INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT
  w.id,
  'record-expense',
  NULL,
  NULL,
  NULL,
  rule.amount_max_minor,
  rule.required_role
FROM workspaces w
CROSS JOIN (
  VALUES
    ('FIELD_SUBMITTER', 100000::bigint),
    ('OPS_MANAGER', 100000::bigint),
    ('FINANCE_APPROVER', 100000::bigint),
    ('ADMIN', 100000::bigint),
    ('FINANCE_APPROVER', NULL::bigint),
    ('ADMIN', NULL::bigint)
) AS rule(required_role, amount_max_minor)
WHERE NOT EXISTS (
  SELECT 1
  FROM approval_rules existing
  WHERE existing.workspace_id = w.id
    AND existing.command_type = 'record-expense'
    AND existing.required_role = rule.required_role
    AND existing.category_code IS NULL
    AND existing.branch_id IS NULL
    AND existing.amount_min_minor IS NULL
    AND existing.amount_max_minor IS NOT DISTINCT FROM rule.amount_max_minor
);

--> statement-breakpoint

-- Runtime grants (db/grants.test.ts convention)
GRANT SELECT, INSERT, UPDATE, DELETE ON posting_periods, financial_entries, financial_postings, number_counters TO routiq_app;

--> statement-breakpoint

-- Append-only: postings are never edited — corrections are new negated rows via
-- reversal entries. The one legitimate UPDATE is the approval-time period
-- assignment, so UPDATE is narrowed to that single column and guarded as a
-- one-time null→value transition. Entries keep guarded UPDATE for lifecycle
-- transitions but can never be deleted.
REVOKE UPDATE, DELETE ON financial_postings FROM routiq_app;

--> statement-breakpoint

GRANT UPDATE (posting_period_id) ON financial_postings TO routiq_app;

--> statement-breakpoint

REVOKE DELETE ON financial_entries FROM routiq_app;
