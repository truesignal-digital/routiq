-- #81: closing a work order declares its cost. The order's actual cost is now
-- derived on read from its non-rejected cost lines; what a v1 close typed is
-- kept as the closer's declaration only, and `cost_outcome` records what a v2
-- close said (LINES, NO_COST, INVOICE_PENDING).
ALTER TABLE "work_orders" ADD COLUMN "declared_cost_minor" bigint;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "cost_outcome" text;--> statement-breakpoint
-- Every amount typed so far was a v1 declaration: it never became a financial
-- entry. Moved as-is; nothing is invented and no cost outcome is guessed.
-- 0033 drops the old column once this copy has run.
UPDATE "work_orders" SET "declared_cost_minor" = "actual_cost_minor" WHERE "actual_cost_minor" IS NOT NULL;
