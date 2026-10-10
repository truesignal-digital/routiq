import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../test/fixture.js";

/**
 * Migrations that claim to be re-appliable, held to that claim.
 *
 * 0019/0020 were numbered 0018 before feat/record-history claimed that slot, so
 * a database that applied the earlier numbering already holds their effects.
 * Re-applying must be a no-op rather than a duplicate-column error, or
 * renumbering would strand any box that ran the old file.
 *
 * 0025/0026 carry the same promise for the maintenance tables: 0025 guards
 * every CREATE and ADD CONSTRAINT, and 0026's approval-rule backfill is written
 * so a second pass inserts nothing. 0027 (the #28 state machines) guards its
 * columns, renames only legacy status values and backfills with NOT EXISTS /
 * ON CONFLICT DO NOTHING. 0028 (notes, #44) guards its table, constraints and
 * policy, and backfills add-note's rules with NOT EXISTS; 0029 is the
 * attach-evidence backfill alone, in the same shape, and 0035 (#84, first
 * numbered 0032) the update-asset-details one. 0034 (#85, first numbered 0032)
 * replaces its functions, drops each trigger before creating it, and backfills
 * update-pending-entry's rules with NOT EXISTS. 0039 (#422) guards its tables,
 * constraints and policies, and inserts its rules and its release row with NOT
 * EXISTS: another branch wanted the same number, so it may yet be renumbered.
 * 0042 (#426, first numbered 0040) guards its columns and constraint, backfills
 * only reversals still without a reason, and replaces its function.
 * 0045 (#334, planned trips) guards its columns, constraints and indexes, and
 * inserts the six scheduling commands' rules with NOT EXISTS.
 * 0046 (#362, first numbered 0045) only deletes dead approval rules, so a second
 * pass deletes nothing.
 * 0048 (#608, maintenance numbers, first numbered 0047) guards its columns and indexes, numbers only
 * rows still without one, moves counters forward only and replaces its trigger.
 * 0049 (#661, first numbered 0047) inserts two document types with ON CONFLICT
 * DO NOTHING.
 *
 * The file's own database has already had all of them applied by the migrator, so
 * running them here IS the replay.
 */
const MIGRATIONS = [
  "0019_member_administration",
  "0020_member_command_defaults",
  "0025_dark_sheva_callister",
  "0026_maintenance_command_defaults",
  "0027_maintenance_state_machines",
  "0028_notes",
  "0029_attach_evidence_command_defaults",
  "0034_edit_pending_entry",
  "0035_update_asset_details_command_defaults",
  "0039_approval_rule_notice",
  "0042_cancellation_reason",
  "0045_planned_trips",
  "0046_platform_scope_entitlement_rules",
  "0048_maintenance_numbers",
  "0049_document_types_visite_carte_grise",
];

function statementsOf(migration: string): string[] {
  return migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

describe("migration replay", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp({ isolated: true });
  });

  afterAll(async () => {
    await ctx.close();
  });

  for (const name of MIGRATIONS) {
    it(`${name} re-applies cleanly`, async () => {
      const path = fileURLToPath(new URL(`../../drizzle/${name}.sql`, import.meta.url));
      const statements = statementsOf(await readFile(path, "utf8"));
      expect(statements.length).toBeGreaterThan(0);

      for (const statement of statements) {
        await ctx.db.execute(sql.raw(statement));
      }
    });
  }
});
