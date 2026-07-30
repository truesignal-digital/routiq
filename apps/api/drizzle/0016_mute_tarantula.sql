ALTER TABLE "audit_events" ADD COLUMN "scope" text DEFAULT 'WORKSPACE' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "tenant_actor_principal_id" uuid GENERATED ALWAYS AS (case when scope = 'PLATFORM' then null else actor_principal_id end) STORED;--> statement-breakpoint
ALTER TABLE "commands" ADD COLUMN "scope" text DEFAULT 'WORKSPACE' NOT NULL;--> statement-breakpoint
ALTER TABLE "commands" ADD COLUMN "tenant_actor_principal_id" uuid GENERATED ALWAYS AS (case when scope = 'PLATFORM' then null else initiated_by_principal_id end) STORED;--> statement-breakpoint
CREATE UNIQUE INDEX "commands_platform_idem_uq" ON "commands" USING btree ("initiated_by_principal_id","idempotency_key") WHERE "commands"."status" = 'EXECUTED' and "commands"."scope" = 'PLATFORM';