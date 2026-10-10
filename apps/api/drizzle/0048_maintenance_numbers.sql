-- Work orders and problems get a number (#608): a per-workspace sequence drawn
-- from number_counters ('WORK_ORDER', 'ISSUE') when the creating command
-- commits (commands/numbering.ts). The uuid stays the key, and the prefix
-- ("OT-0007", "WO-0007") lives in the web catalogs, not here.
--
-- Rows that predate the column are numbered in creation order: their creating
-- command's executed_at, uuid as the tie-break. Not reported_at, which is the
-- device's clock for a report captured offline.
--
-- Every statement is re-appliable (migration-replay.test.ts): only rows still
-- without a number are numbered, after the highest one already given, and a
-- counter only ever moves forward.

ALTER TABLE "operational_issues" ADD COLUMN IF NOT EXISTS "number" integer;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "number" integer;--> statement-breakpoint

UPDATE operational_issues AS issue
SET number = numbered.number
FROM (
  SELECT i.id,
         coalesce(given.max_number, 0)
           + row_number() OVER (PARTITION BY i.workspace_id ORDER BY c.executed_at, i.id) AS number
  FROM operational_issues AS i
  JOIN commands AS c ON c.id = i.created_by_command_id
  LEFT JOIN (
    SELECT workspace_id, max(number) AS max_number
    FROM operational_issues
    GROUP BY workspace_id
  ) AS given ON given.workspace_id = i.workspace_id
  WHERE i.number IS NULL
) AS numbered
WHERE issue.id = numbered.id;

--> statement-breakpoint

UPDATE work_orders AS work_order
SET number = numbered.number
FROM (
  SELECT w.id,
         coalesce(given.max_number, 0)
           + row_number() OVER (PARTITION BY w.workspace_id ORDER BY c.executed_at, w.id) AS number
  FROM work_orders AS w
  JOIN commands AS c ON c.id = w.created_by_command_id
  LEFT JOIN (
    SELECT workspace_id, max(number) AS max_number
    FROM work_orders
    GROUP BY workspace_id
  ) AS given ON given.workspace_id = w.workspace_id
  WHERE w.number IS NULL
) AS numbered
WHERE work_order.id = numbered.id;

--> statement-breakpoint

-- The next draw continues after the back-filled numbers.
INSERT INTO number_counters (workspace_id, scope, next_value)
SELECT workspace_id, 'ISSUE', max(number) + 1
FROM operational_issues
GROUP BY workspace_id
ON CONFLICT (workspace_id, scope)
DO UPDATE SET next_value = GREATEST(number_counters.next_value, EXCLUDED.next_value);

--> statement-breakpoint

INSERT INTO number_counters (workspace_id, scope, next_value)
SELECT workspace_id, 'WORK_ORDER', max(number) + 1
FROM work_orders
GROUP BY workspace_id
ON CONFLICT (workspace_id, scope)
DO UPDATE SET next_value = GREATEST(number_counters.next_value, EXCLUDED.next_value);

--> statement-breakpoint

ALTER TABLE "operational_issues" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "operational_issues_ws_number_uq" ON "operational_issues" USING btree ("workspace_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_orders_ws_number_uq" ON "work_orders" USING btree ("workspace_id","number");--> statement-breakpoint

-- A number is set once. routiq_app holds UPDATE on operational_issues only for
-- named columns, so the problem's number is already out of its reach; it holds
-- UPDATE on all of work_orders, so a trigger keeps the order's number fixed.
CREATE OR REPLACE FUNCTION guard_work_order_number() RETURNS trigger AS $$
BEGIN
  IF NEW.number IS DISTINCT FROM OLD.number THEN
    RAISE EXCEPTION 'work_orders.number is set once (work order %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

DROP TRIGGER IF EXISTS work_orders_number_fixed ON work_orders;--> statement-breakpoint
CREATE TRIGGER work_orders_number_fixed
  BEFORE UPDATE OF number ON work_orders
  FOR EACH ROW EXECUTE FUNCTION guard_work_order_number();
