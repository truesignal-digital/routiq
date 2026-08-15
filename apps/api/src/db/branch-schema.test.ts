import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { branches, commands } from "./schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

/**
 * Structural guarantees for `branches`, asserted against the database rather
 * than through handlers — the point is that they survive a bug in, or a bypass
 * of, the command layer.
 */
/** Drizzle wraps driver errors, so the SQLSTATE lives on `cause`, not the top level. */
async function pgErrorCode(run: Promise<unknown>): Promise<string | undefined> {
  try {
    await run;
    return undefined;
  } catch (error) {
    const wrapped = error as { code?: string; cause?: { code?: string } };
    return wrapped.cause?.code ?? wrapped.code;
  }
}

describe("branches schema", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let commandId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    workspaceId = (await seedWorkspace(ctx.db)).workspace.id;
    otherWorkspaceId = (await seedWorkspace(ctx.db)).workspace.id;

    // commands_ws_principal_fk requires the actor to hold a membership.
    const { principal } = await seedMember(ctx.db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });

    commandId = randomUUID();
    await ctx.db.insert(commands).values({
      id: commandId,
      workspaceId,
      commandType: "schema-test",
      origin: "API",
      status: "EXECUTED",
      initiatedByPrincipalId: principal.id,
      idempotencyKey: `idem-${randomUUID()}`,
      payload: {},
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe("created_by_command_id tenant FK", () => {
    it("accepts a command from the same workspace", async () => {
      await expect(
        ctx.db.insert(branches).values({
          workspaceId,
          code: `SC${randomUUID().slice(0, 4).toUpperCase()}`,
          name: `Same workspace ${randomUUID().slice(0, 8)}`,
          createdByCommandId: commandId,
        }),
      ).resolves.toBeDefined();
    });

    it("rejects a command from another workspace", async () => {
      expect(
        await pgErrorCode(
          ctx.db.insert(branches).values({
            workspaceId: otherWorkspaceId,
            code: `XW${randomUUID().slice(0, 4).toUpperCase()}`,
            name: `Cross workspace ${randomUUID().slice(0, 8)}`,
            createdByCommandId: commandId,
          }),
        ),
      ).toBe("23503");
    });

    it("accepts a NULL command — branches predating 0021 carry none", async () => {
      await expect(
        ctx.db.insert(branches).values({
          workspaceId,
          code: `NC${randomUUID().slice(0, 4).toUpperCase()}`,
          name: `No command ${randomUUID().slice(0, 8)}`,
        }),
      ).resolves.toBeDefined();
    });
  });
});
