import { randomUUID } from "node:crypto";
import { createBranchCommand, registerPersonCommand } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { auditEvents, branches } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

describe("create-branch.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  let token: string;
  let opsToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    const member = await seedMember(ctx.db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    token = (
      await createSession(ctx.db, {
        workspaceId,
        principalId: member.principal.id,
      })
    ).token;
    const ops = await seedMember(ctx.db, {
      workspaceId,
      role: "OPS_MANAGER",
      allBranches: true,
    });
    opsToken = (
      await createSession(ctx.db, {
        workspaceId,
        principalId: ops.principal.id,
      })
    ).token;
  });

  afterAll(async () => {
    await ctx.close();
  });

  function post(
    payload: Record<string, unknown>,
    opts: { commandId?: string; idempotencyKey?: string; token?: string } = {},
  ) {
    const body = createBranchCommand.parse({
      name: "create-branch",
      version: 1,
      envelope: {
        commandId: opts.commandId ?? randomUUID(),
        idempotencyKey: opts.idempotencyKey ?? `idem-${randomUUID()}`,
        origin: "HUMAN_UI",
      },
      payload,
    });
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands/create-branch",
      headers: { authorization: `Bearer ${opts.token ?? token}` },
      payload: body,
    });
  }

  it("creates an active branch stamped and audited at version one", async () => {
    const branchId = randomUUID();
    const commandId = randomUUID();
    const response = await post(
      {
        branchId,
        code: "YDE",
        name: "Yaoundé",
        timezone: "Africa/Douala",
      },
      { commandId },
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ recordId: branchId, rowVersion: 1 });

    const [row] = await ctx.db.select().from(branches).where(eq(branches.id, branchId));
    expect(row).toMatchObject({
      workspaceId,
      code: "YDE",
      name: "Yaoundé",
      timezone: "Africa/Douala",
      active: true,
      createdByCommandId: commandId,
      rowVersion: 1,
    });

    const [audit] = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, branchId));
    expect(audit).toMatchObject({
      eventType: "branch.created",
      entityType: "branch",
      entityId: branchId,
    });
  });

  it("returns DUPLICATE_BRANCH_CODE when the workspace already uses the code", async () => {
    const code = "BR2";
    const first = await post({ branchId: randomUUID(), code, name: "First branch" });
    expect(first.statusCode).toBe(200);

    const second = await post({ branchId: randomUUID(), code, name: "Duplicate branch" });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({
      error: { code: "DUPLICATE_BRANCH_CODE" },
    });

    const rows = await ctx.db
      .select()
      .from(branches)
      .where(and(eq(branches.workspaceId, workspaceId), eq(branches.code, code)));
    expect(rows).toHaveLength(1);
  });

  it("returns DUPLICATE_BRANCH_NAME when the workspace already uses the name", async () => {
    const name = "Agence du Centre";
    const first = await post({ branchId: randomUUID(), code: "CTR", name });
    expect(first.statusCode).toBe(200);

    const second = await post({ branchId: randomUUID(), code: "CTR2", name });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({
      error: { code: "DUPLICATE_BRANCH_NAME" },
    });

    const rows = await ctx.db
      .select()
      .from(branches)
      .where(and(eq(branches.workspaceId, workspaceId), eq(branches.name, name)));
    expect(rows).toHaveLength(1);
  });

  it("replays an identical retry instead of creating a second branch", async () => {
    const branchId = randomUUID();
    const key = `idem-${randomUUID()}`;
    const payload = {
      branchId,
      code: "IDEM1",
      name: "Idempotent branch",
    };

    const first = await post(payload, { idempotencyKey: key });
    expect(first.statusCode).toBe(200);
    const second = await post(payload, { idempotencyKey: key });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ recordId: branchId, idempotentReplay: true });

    const rows = await ctx.db.select().from(branches).where(eq(branches.id, branchId));
    expect(rows).toHaveLength(1);
  });

  it("is ADMIN-only", async () => {
    const response = await post(
      {
        branchId: randomUUID(),
        code: "OPS1",
        name: "Forbidden branch",
      },
      { token: opsToken },
    );

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });
  });

  it("makes the new branch immediately usable by branch-based commands", async () => {
    const branchId = randomUUID();
    const code = "USE1";
    const created = await post({ branchId, code, name: "Usable branch" });
    expect(created.statusCode).toBe(200);

    const personId = randomUUID();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/register-person",
      headers: { authorization: `Bearer ${token}` },
      payload: registerPersonCommand.parse({
        name: "register-person",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: {
          personId,
          displayName: "New branch driver",
          branchCode: code,
        },
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ recordId: personId, rowVersion: 1 });
  });
});
