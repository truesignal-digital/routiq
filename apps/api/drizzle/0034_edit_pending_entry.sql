-- Custom SQL migration file, put your code below! --
-- The author edits their own pending entry (#85, level 2 of ADR-0008): until
-- someone decides it, nothing has been relied on, so update-pending-entry
-- changes the entry in place and replaces its lines. Three database rules move
-- with it, each only as far as that needs. Who may edit (the author) is the
-- command layer's rule; the database holds what may change, and when.
--
-- 1. An entry's facts (category, date, amount, payee, payment, text) may change
--    while it is SUBMITTED and stays SUBMITTED, with no posting period. Its
--    identity (number, direction, branch, what it reverses, its creating
--    command) never changes, and a decided entry's facts stay frozen:
--    corrections reverse (§3.4).
-- 2. A line may be deleted only while its entry is SUBMITTED and the line has
--    no posting period, the state approve-entry ends. Lines of a posted,
--    rejected or reversed entry stay append-only. The replaced lines live on
--    in the audit event's before-state.
-- 3. The balance check (0031) also runs when an entry's amount changes and when
--    a line is deleted, so an edit that moves the amount without replacing its
--    lines fails at COMMIT like an unbalanced insert does.
--
-- Plus the approval defaults for update-pending-entry, for workspaces that
-- predate it; provisioning/packs/core.ts gives new workspaces the same rows.
-- Re-appliable: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, NOT EXISTS.

CREATE OR REPLACE FUNCTION guard_financial_entry_update() RETURNS trigger AS $$
BEGIN
  IF ROW(
    NEW.workspace_id, NEW.entry_number, NEW.direction, NEW.branch_id,
    NEW.reverses_entry_id, NEW.created_by_command_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.workspace_id, OLD.entry_number, OLD.direction, OLD.branch_id,
    OLD.reverses_entry_id, OLD.created_by_command_id, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'financial entry identity is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF ROW(
    NEW.category_id, NEW.economic_date, NEW.counterparty_name, NEW.description,
    NEW.amount_minor, NEW.currency, NEW.payment_method, NEW.payment_reference,
    NEW.source_reference, NEW.estimate_status
  ) IS DISTINCT FROM ROW(
    OLD.category_id, OLD.economic_date, OLD.counterparty_name, OLD.description,
    OLD.amount_minor, OLD.currency, OLD.payment_method, OLD.payment_reference,
    OLD.source_reference, OLD.estimate_status
  ) AND NOT (
    OLD.status = 'SUBMITTED' AND NEW.status = 'SUBMITTED'
    AND OLD.posting_period_id IS NULL AND NEW.posting_period_id IS NULL
  ) THEN
    RAISE EXCEPTION 'financial entry economic facts are immutable once decided'
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
CREATE OR REPLACE FUNCTION guard_financial_posting_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.posting_period_id IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM financial_entries e
    WHERE e.workspace_id = OLD.workspace_id
      AND e.id = OLD.financial_entry_id
      AND e.status = 'SUBMITTED'
  ) THEN
    RAISE EXCEPTION 'financial postings are removable only from a pending entry'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS financial_postings_pending_delete ON financial_postings;
--> statement-breakpoint
CREATE TRIGGER financial_postings_pending_delete
  BEFORE DELETE ON financial_postings
  FOR EACH ROW EXECUTE FUNCTION guard_financial_posting_delete();
--> statement-breakpoint
GRANT DELETE ON financial_postings TO routiq_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_financial_entry_balance() RETURNS trigger AS $$
DECLARE
  entry_workspace_id uuid;
  entry_id uuid;
  entry_amount bigint;
  posted bigint;
BEGIN
  -- Separate branches: each assignment is planned only for the table it names,
  -- and a DELETE has only OLD.
  IF TG_TABLE_NAME = 'financial_entries' THEN
    entry_workspace_id := NEW.workspace_id;
    entry_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    entry_workspace_id := OLD.workspace_id;
    entry_id := OLD.financial_entry_id;
  ELSE
    entry_workspace_id := NEW.workspace_id;
    entry_id := NEW.financial_entry_id;
  END IF;

  SELECT amount_minor INTO entry_amount
  FROM financial_entries
  WHERE workspace_id = entry_workspace_id AND id = entry_id;

  SELECT coalesce(sum(amount_minor), 0) INTO posted
  FROM financial_postings
  WHERE workspace_id = entry_workspace_id AND financial_entry_id = entry_id;

  IF entry_amount IS DISTINCT FROM posted THEN
    RAISE EXCEPTION 'financial entry % has postings summing to %, not its amount %',
      entry_id, posted, entry_amount
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS financial_entries_balance_on_edit ON financial_entries;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER financial_entries_balance_on_edit
  AFTER UPDATE OF amount_minor ON financial_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_financial_entry_balance();
--> statement-breakpoint
DROP TRIGGER IF EXISTS financial_postings_balance_on_delete ON financial_postings;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER financial_postings_balance_on_delete
  AFTER DELETE ON financial_postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_financial_entry_balance();
--> statement-breakpoint
-- update-pending-entry: record-expense's roles without its amount band. The
-- band that decides the entry is its own: the handler re-reads it under
-- record-expense or record-revenue, so a tenant's threshold applies once.
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
    ('update-pending-entry', 'FIELD_SUBMITTER'),
    ('update-pending-entry', 'OPS_MANAGER'),
    ('update-pending-entry', 'FINANCE_APPROVER'),
    ('update-pending-entry', 'ADMIN'),
    ('update-pending-entry', 'MAINTENANCE')
) AS c(command_type, required_role)
WHERE NOT EXISTS (
  SELECT 1
  FROM approval_rules r
  WHERE r.workspace_id = w.id
    AND r.command_type = c.command_type
    AND r.required_role = c.required_role
);
