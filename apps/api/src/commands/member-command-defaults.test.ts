import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { approvalRules } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

const MEMBER_COMMANDS = [
  "add-member",
  "update-member-role",
  "deactivate-member",
  "reactivate-member",
  "reset-member-pin",
] as const;

const BACKFILL = fileURLToPath(
  new URL("../../drizzle/0020_member_command_defaults.sql", import.meta.url),
);

/**
 * The catalog defaults in the core pack only run when a workspace is created, so
 * every tenant that predates these commands would meet them with no matching
 * approval rule — and no matching rule means APPROVAL_REQUIRED, which the
 * dispatcher turns into 403 on every call. That is the whole reason migration
 * 0020 exists, and these tests run the shipped SQL rather than a copy of it.
 */
describe("member command approval defaults", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let backfillSql: string;

  beforeAll(async () => {
    ctx = await createTestApp({ isolated: true });
    backfillSql = await readFile(BACKFILL, "utf8");
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function memberRulesOf(workspaceId: string) {
    return ctx.db
      .select({ commandType: approvalRules.commandType, requiredRole: approvalRules.requiredRole })
      .from(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, workspaceId),
          inArray(approvalRules.commandType, [...MEMBER_COMMANDS]),
        ),
      );
  }

  /** A workspace as it looked before this branch: the member rules stripped out. */
  async function seedPreUpgradeWorkspace() {
    const seeded = await seedWorkspace(ctx.db, `ws-backfill-${randomUUID().slice(0, 8)}`);
    await ctx.db
      .delete(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, seeded.workspace.id),
          inArray(approvalRules.commandType, [...MEMBER_COMMANDS]),
        ),
      );
    return seeded;
  }

  it("gives an existing workspace the five ADMIN rules it was missing", async () => {
    const seeded = await seedPreUpgradeWorkspace();
    expect(await memberRulesOf(seeded.workspace.id)).toHaveLength(0);

    await ctx.db.execute(sql.raw(backfillSql));

    const rules = await memberRulesOf(seeded.workspace.id);
    expect(rules.map((rule) => rule.commandType).sort()).toEqual([...MEMBER_COMMANDS].sort());
    expect(rules.every((rule) => rule.requiredRole === "ADMIN")).toBe(true);
  });

  it("adds nothing on a second run", async () => {
    const seeded = await seedPreUpgradeWorkspace();
    await ctx.db.execute(sql.raw(backfillSql));
    const afterFirst = await memberRulesOf(seeded.workspace.id);

    await ctx.db.execute(sql.raw(backfillSql));
    expect(await memberRulesOf(seeded.workspace.id)).toHaveLength(afterFirst.length);
  });

  /** The behaviour the backfill exists to restore, end to end. */
  it("lets a backfilled workspace run a member command instead of 403", async () => {
    const seeded = await seedPreUpgradeWorkspace();
    const admin = await seedMember(ctx.db, {
      workspaceId: seeded.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    const token = (
      await createSession(ctx.db, {
        workspaceId: seeded.workspace.id,
        principalId: admin.principal.id,
      })
    ).token;

    const call = () =>
      ctx.app.inject({
        method: "POST",
        url: "/v1/commands/add-member",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey: `idem-${randomUUID()}`,
            origin: "HUMAN_UI",
          },
          payload: {
            principalId: randomUUID(),
            displayName: "Après migration",
            username: `user-${randomUUID().slice(0, 8)}`,
            pin: "4821",
            role: "FIELD_SUBMITTER",
            branchScope: "ALL",
          },
        },
      });

    const before = await call();
    expect(before.statusCode).toBe(403);
    expect(before.json()).toMatchObject({ error: { code: "APPROVAL_REQUIRED" } });

    await ctx.db.execute(sql.raw(backfillSql));

    const after = await call();
    expect(after.statusCode).toBe(200);
  });
});
