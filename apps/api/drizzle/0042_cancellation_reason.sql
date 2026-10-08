-- Cancel entry (#426): why an entry was cancelled, kept on the cancellation
-- (the reversal row) as a code from a short list, plus the person's words for
-- OTHER. Set once when reverse-entry inserts the row, never edited after.
--
-- reverse-entry.v1 took free text only, and kept it in the audit trail. Those
-- reversals become OTHER with the text their reversal_posted event recorded.
--
-- Every statement is re-appliable (migration-replay.test.ts).

ALTER TABLE "financial_entries" ADD COLUMN IF NOT EXISTS "reversal_reason_code" text;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD COLUMN IF NOT EXISTS "reversal_reason_text" text;--> statement-breakpoint

UPDATE financial_entries AS reversal
SET reversal_reason_code = 'OTHER',
    reversal_reason_text = (
      SELECT event.after_state ->> 'reason'
      FROM audit_events AS event
      WHERE event.workspace_id = reversal.workspace_id
        AND event.entity_id = reversal.id
        AND event.event_type = 'financial_entry.reversal_posted'
        AND jsonb_typeof(event.after_state -> 'reason') = 'string'
      ORDER BY event.occurred_at
      LIMIT 1
    )
WHERE reversal.reverses_entry_id IS NOT NULL
  AND reversal.reversal_reason_code IS NULL;

--> statement-breakpoint

-- A reason belongs to a cancellation and every cancellation has one.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'financial_entries_reversal_reason_ck'
      AND conrelid = 'financial_entries'::regclass
  ) THEN
    ALTER TABLE financial_entries
      ADD CONSTRAINT financial_entries_reversal_reason_ck CHECK (
        (reverses_entry_id IS NULL AND reversal_reason_code IS NULL AND reversal_reason_text IS NULL)
        OR (
          reverses_entry_id IS NOT NULL
          AND reversal_reason_code IN ('ENTERED_TWICE', 'DID_NOT_HAPPEN', 'WRONG_DETAILS', 'OTHER')
        )
      );
  END IF;
END $$;

--> statement-breakpoint

-- 0034's guard with the reason added to what never changes after insert.
CREATE OR REPLACE FUNCTION guard_financial_entry_update() RETURNS trigger AS $$
BEGIN
  IF ROW(
    NEW.workspace_id, NEW.entry_number, NEW.direction, NEW.branch_id,
    NEW.reverses_entry_id, NEW.reversal_reason_code, NEW.reversal_reason_text,
    NEW.created_by_command_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.workspace_id, OLD.entry_number, OLD.direction, OLD.branch_id,
    OLD.reverses_entry_id, OLD.reversal_reason_code, OLD.reversal_reason_text,
    OLD.created_by_command_id, OLD.created_at
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
