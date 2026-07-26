DROP INDEX "commands_ws_idem_uq";--> statement-breakpoint
ALTER TABLE "commands" ADD COLUMN "client_command_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "commands_ws_idem_uq" ON "commands" USING btree ("workspace_id","idempotency_key") WHERE "commands"."status" = 'EXECUTED';