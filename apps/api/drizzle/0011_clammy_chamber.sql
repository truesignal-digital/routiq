ALTER TABLE "financial_entries" ALTER COLUMN "currency" SET DATA TYPE char(3);--> statement-breakpoint
ALTER TABLE "financial_entries" ALTER COLUMN "currency" SET DEFAULT 'XAF';