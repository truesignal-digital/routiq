import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../test/fixture.js";

/**
 * These two migrations were numbered 0018 before feat/record-history claimed
 * that slot, so a database that applied the earlier numbering already holds
 * their effects. Re-applying must be a no-op rather than a duplicate-column
 * error, or renumbering would strand any box that ran the old file.
 *
 * The suite's database has already had both applied by the migrator, so running
 * them here IS the replay.
 */
const MIGRATIONS = ["0019_member_administration", "0020_member_command_defaults"];

function statementsOf(migration: string): string[] {
  return migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

describe("migration replay", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp();
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
