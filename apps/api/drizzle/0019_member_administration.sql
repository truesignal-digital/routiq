-- Day-2 member administration, plus the receipt column its secrets forced.
--
-- `memberships.deactivated_at` is the authorization boundary —
-- `resolveAuthContext` refuses a membership carrying it, so revocation bites on
-- the next request instead of when the session happens to expire. It is
-- deliberately separate from `credentials.disabled_at` (the login boundary,
-- already present): a principal can hold a membership without ever holding a
-- credential, so revoking access means shutting both doors.
--
-- `memberships.row_version` gives memberships the optimistic-concurrency column
-- every other mutable table already has (§3.4), so a role change carries
-- expectedVersion instead of clobbering a concurrent edit.
--
-- `commands.payload_hash` is what makes redaction safe for idempotency. A
-- receipt stores the payload with every secret replaced by one marker, so
-- comparing stored payloads would read two PIN resets under one key as the same
-- request and replay the first — reporting success for a PIN it never set. The
-- hash is taken over the payload as it arrived, before redaction, and only the
-- hash is kept. NULL on existing rows, which keep the old payload comparison.
--
-- Numbered 0019 because feat/record-history owns 0018 and merges first; the gap
-- closes when that branch lands.
--
-- No new table, so no new GRANT: routiq_app already holds the privileges for
-- both tables from migration 0004.

ALTER TABLE "commands" ADD COLUMN "payload_hash" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "row_version" integer DEFAULT 1 NOT NULL;