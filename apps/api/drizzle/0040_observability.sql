-- Observability (ADR-0011).
--
-- commands.duration_ms: server time from receiving a call to finalising its
-- receipt, so the command ledger answers "which writes are slow" as well as
-- "which writes fail". Null on receipts written before this migration.
--
-- telemetry.events: field measurements from the web app. A schema of its own
-- because it is not business state: no command writes it and no tenant read
-- serves it. The runtime role may INSERT, and DELETE rows past retention,
-- which needs SELECT on received_at only; it can never read an event back.
-- Operators read it with the owner role (pnpm observe).

CREATE SCHEMA "telemetry";
--> statement-breakpoint
CREATE TABLE "telemetry"."events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"workspace_id" uuid,
	"role" text,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"value" double precision,
	"server_ms" double precision,
	"outcome" text,
	"route" text NOT NULL,
	"app_version" text NOT NULL,
	"message" text,
	"stack" text,
	"fingerprint" text,
	"device" jsonb,
	"detail" jsonb
);
--> statement-breakpoint
ALTER TABLE "commands" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "telemetry"."events" ADD CONSTRAINT "events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telemetry_events_received_idx" ON "telemetry"."events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "telemetry_events_kind_name_idx" ON "telemetry"."events" USING btree ("kind","name","received_at");
--> statement-breakpoint
ALTER TABLE "telemetry"."events" ADD CONSTRAINT "events_kind_check" CHECK ("kind" IN ('session', 'error', 'vital', 'journey'));--> statement-breakpoint
GRANT USAGE ON SCHEMA "telemetry" TO routiq_app;--> statement-breakpoint
GRANT INSERT, DELETE ON "telemetry"."events" TO routiq_app;--> statement-breakpoint
GRANT SELECT ("received_at") ON "telemetry"."events" TO routiq_app;
