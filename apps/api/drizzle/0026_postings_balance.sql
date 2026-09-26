-- Postings sum exactly to their entry (§3.4). The writers check it before they
-- insert (financial-entry-writer.ts, reverse-entry.ts); this makes it a fact of
-- the database, so a future writer, script or repair cannot commit an entry
-- whose lines disagree with its amount.
--
-- Checked at COMMIT (DEFERRABLE INITIALLY DEFERRED): an entry and its postings
-- are inserted as separate statements in one transaction, so any per-row check
-- would see a half-written entry. Only INSERTs need checking: entry amounts
-- are immutable (guard_financial_entry_update, 0010) and postings are
-- append-only for the runtime role. Runs as the caller, so RLS scopes both
-- lookups to the transaction's workspace.

CREATE OR REPLACE FUNCTION check_financial_entry_balance() RETURNS trigger AS $$
DECLARE
  entry_id uuid;
  entry_amount bigint;
  posted bigint;
BEGIN
  -- Separate branches: each assignment is planned only for the table it names.
  IF TG_TABLE_NAME = 'financial_entries' THEN
    entry_id := NEW.id;
  ELSE
    entry_id := NEW.financial_entry_id;
  END IF;

  SELECT amount_minor INTO entry_amount
  FROM financial_entries
  WHERE workspace_id = NEW.workspace_id AND id = entry_id;

  SELECT coalesce(sum(amount_minor), 0) INTO posted
  FROM financial_postings
  WHERE workspace_id = NEW.workspace_id AND financial_entry_id = entry_id;

  IF entry_amount IS DISTINCT FROM posted THEN
    RAISE EXCEPTION 'financial entry % has postings summing to %, not its amount %',
      entry_id, posted, entry_amount
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER financial_entries_balance
  AFTER INSERT ON financial_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_financial_entry_balance();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER financial_postings_balance
  AFTER INSERT ON financial_postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_financial_entry_balance();
