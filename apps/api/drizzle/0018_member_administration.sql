-- Day-2 member administration: the two columns the member commands turn on.
--
-- `deactivated_at` is the authorization boundary — `resolveAuthContext` refuses
-- a membership carrying it, so revocation bites on the next request instead of
-- when the session happens to expire. It is deliberately separate from
-- `credentials.disabled_at` (the login boundary, already present): a principal
-- can hold a membership without ever holding a credential, so revoking access
-- means shutting both doors.
--
-- `row_version` gives memberships the optimistic-concurrency column every other
-- mutable table already has (§3.4), so a role change carries expectedVersion
-- instead of clobbering a concurrent edit.
--
-- No new table, so no new GRANT: routiq_app already holds the memberships
-- privileges from migration 0004.

ALTER TABLE "memberships" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "row_version" integer DEFAULT 1 NOT NULL;