import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { resolveOperatorContext } from "../auth/context.js";
import type { AuthContext, OperatorContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import { platformDb, type PlatformDb } from "../db/platform.js";
import { assets, auditEvents, branches, commands, principals, workspaces } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import { appendPlatformAuditEvent, dispatchCommand, registerPlatformCommand } from "./dispatcher.js";

/**
 * A stand-in for provision-workspace (issue 04): enough of the same shape to
 * exercise the seam — it creates its own workspace, then writes a row stamped
 * with the command id, which only works if the receipt landed between the two.
 */
registerPlatformCommand({
  scope: "platform",
  name: "test-provision",
  version: 1,
  payloadSchema: z.strictObject({
    newWorkspaceId: z.uuid(),
    branchId: z.uuid(),
    assetId: z.uuid(),
    slug: z.string().min(1),
  }),
  resolveWorkspace: async (tx, _ctx, _envelope, payload) => {
    await tx
      .insert(workspaces)
      .values({ id: payload.newWorkspaceId, slug: payload.slug, name: payload.slug });
    return payload.newWorkspaceId;
  },
  execute: async (tx, ctx, envelope, payload, workspaceId) => {
    await tx
      .insert(branches)
      .values({ id: payload.branchId, workspaceId, code: "DLA", name: "Douala" });
    await tx.insert(assets).values({
      id: payload.assetId,
      workspaceId,
      branchId: payload.branchId,
      assetCode: "TRUCK-001",
      assetClassCode: "TRUCK",
      templateCode: "TRUCKING",
      createdByCommandId: envelope.commandId,
    });
    await appendPlatformAuditEvent(tx, ctx, workspaceId, envelope, {
      eventType: "workspace.provisioned",
      entityType: "workspace",
      entityId: workspaceId,
    });
    return { recordId: workspaceId, rowVersion: 1 };
  },
});

describe("platform command scope", () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let platform: PlatformDb;
  let operator: OperatorContext;
  let tenant: AuthContext;

  beforeAll(async () => {
    testApp = await createTestApp();
    db = testApp.db;
    platform = platformDb(db);

    const [row] = await db
      .insert(principals)
      .values({ principalType: "VENDOR_OPERATOR", displayName: "vendor-cli" })
      .returning();
    if (!row) throw new Error("operator principal insert returned no row");
    const resolved = await resolveOperatorContext(db, row.id);
    if (!resolved) throw new Error("operator context did not resolve");
    operator = resolved;

    const seeded = await seedWorkspace(db);
    const member = await seedMember(db, {
      workspaceId: seeded.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    tenant = {
      workspaceId: seeded.workspace.id,
      principalId: member.principal.id,
      principalType: "HUMAN",
      membershipId: member.membership.id,
      role: "ADMIN",
      branchScope: "ALL",
    };
  });

  afterAll(async () => {
    await testApp.close();
  });

  function provisionBody(overrides: { idempotencyKey?: string; slug?: string } = {}) {
    const workspaceId = randomUUID();
    return {
      name: "test-provision",
      version: 1,
      envelope: {
        commandId: randomUUID(),
        idempotencyKey: overrides.idempotencyKey ?? `idem-${randomUUID()}`,
        origin: "API",
      },
      payload: {
        newWorkspaceId: workspaceId,
        branchId: randomUUID(),
        assetId: randomUUID(),
        slug: overrides.slug ?? `ws-${workspaceId.slice(0, 8)}`,
      },
    };
  }

  it("the vendor operator holds no membership anywhere", async () => {
    const context = await resolveOperatorContext(db, operator.principalId);
    expect(context).toMatchObject({ kind: "platform", principalType: "VENDOR_OPERATOR" });
  });

  it("refuses a platform command run from a workspace session", async () => {
    const result = await dispatchCommand(testApp.runtimeDb, tenant, provisionBody());

    expect(result.status).toBe(403);
    expect(result.body).toEqual({
      error: {
        code: "COMMAND_SCOPE_FORBIDDEN",
        metadata: {
          command: "test-provision.v1",
          commandScope: "platform",
          actorScope: "workspace",
        },
      },
    });
  });

  it("refuses a workspace command run by the vendor operator", async () => {
    const result = await dispatchCommand(platform, operator, {
      name: "register-asset",
      version: 1,
      envelope: {
        commandId: randomUUID(),
        idempotencyKey: `idem-${randomUUID()}`,
        origin: "API",
      },
      payload: {
        assetId: randomUUID(),
        assetCode: "TRUCK-999",
        assetClassCode: "TRUCK",
        templateCode: "TRUCKING",
        branchCode: "DLA",
      },
    });

    expect(result.status).toBe(403);
    expect(result.body).toEqual({
      error: {
        code: "COMMAND_SCOPE_FORBIDDEN",
        metadata: {
          command: "register-asset.v1",
          commandScope: "workspace",
          actorScope: "platform",
        },
      },
    });
  });

  it("writes workspace, receipt and stamped rows in one transaction", async () => {
    const body = provisionBody();
    const result = await dispatchCommand(platform, operator, body);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      recordId: body.payload.newWorkspaceId,
      idempotentReplay: false,
    });

    const [receipt] = await db
      .select()
      .from(commands)
      .where(eq(commands.id, body.envelope.commandId));
    expect(receipt).toMatchObject({
      scope: "PLATFORM",
      status: "EXECUTED",
      workspaceId: body.payload.newWorkspaceId,
      initiatedByPrincipalId: operator.principalId,
      approvalOutcome: null,
      approvalRuleId: null,
    });

    const [asset] = await db.select().from(assets).where(eq(assets.id, body.payload.assetId));
    expect(asset?.createdByCommandId).toBe(body.envelope.commandId);

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.commandId, body.envelope.commandId));
    expect(event).toMatchObject({
      workspaceId: body.payload.newWorkspaceId,
      actorPrincipalId: operator.principalId,
      eventType: "workspace.provisioned",
    });
  });

  it("replays a platform command by operator and key, not by workspace", async () => {
    const body = provisionBody();
    const first = await dispatchCommand(platform, operator, body);
    expect(first.status).toBe(200);

    const replay = await dispatchCommand(platform, operator, body);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ ...first.body, idempotentReplay: true });

    const executed = await db
      .select()
      .from(commands)
      .where(
        and(
          eq(commands.initiatedByPrincipalId, operator.principalId),
          eq(commands.idempotencyKey, body.envelope.idempotencyKey),
          eq(commands.status, "EXECUTED"),
        ),
      );
    expect(executed).toHaveLength(1);

    const created = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, body.payload.slug));
    expect(created).toHaveLength(1);
  });

  it("rejects the same key with a different payload", async () => {
    const idempotencyKey = `idem-${randomUUID()}`;
    const first = await dispatchCommand(platform, operator, provisionBody({ idempotencyKey }));
    expect(first.status).toBe(200);

    const reused = await dispatchCommand(platform, operator, provisionBody({ idempotencyKey }));
    expect(reused.status).toBe(409);
    expect(reused.body).toMatchObject({ error: { code: "IDEMPOTENCY_KEY_REUSED" } });
  });

  /**
   * The exemption is the whole risk of this seam: moving the tenant-actor FK
   * onto a generated column would be a silent hole if a WORKSPACE row could
   * also slip past it. Only the database can answer that, so ask it directly.
   */
  it("still refuses a workspace receipt or audit event whose actor is not a member", async () => {
    const other = await seedWorkspace(db);
    const member = await seedMember(db, {
      workspaceId: other.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    const outsider = tenant.principalId;

    expect(
      await violatedConstraint(
        db.insert(commands).values({
          id: randomUUID(),
          workspaceId: other.workspace.id,
          commandType: "register-asset",
          commandVersion: "1",
          origin: "API",
          status: "EXECUTED",
          initiatedByPrincipalId: outsider,
          idempotencyKey: `idem-${randomUUID()}`,
          payload: {},
        }),
      ),
    ).toBe("commands_ws_principal_fk");

    const receiptId = randomUUID();
    await db.insert(commands).values({
      id: receiptId,
      workspaceId: other.workspace.id,
      commandType: "register-asset",
      commandVersion: "1",
      origin: "API",
      status: "EXECUTED",
      initiatedByPrincipalId: member.principal.id,
      idempotencyKey: `idem-${randomUUID()}`,
      payload: {},
    });

    expect(
      await violatedConstraint(
        db.insert(auditEvents).values({
          workspaceId: other.workspace.id,
          commandId: receiptId,
          eventType: "asset.registered",
          actorPrincipalId: outsider,
          entityType: "asset",
          entityId: randomUUID(),
        }),
      ),
    ).toBe("audit_events_ws_principal_fk");
  });

  it("leaves nothing behind when a platform command fails", async () => {
    const body = provisionBody();
    const conflicting = {
      ...body,
      payload: { ...body.payload, slug: (await firstWorkspaceSlug(db)) ?? "ws-none" },
    };

    const result = await dispatchCommand(platform, operator, conflicting);
    expect(result.status).toBe(409);

    const receipts = await db
      .select()
      .from(commands)
      .where(eq(commands.idempotencyKey, body.envelope.idempotencyKey));
    expect(receipts).toEqual([]);
  });
});

/** Drizzle wraps driver errors, so the constraint name lives on the cause. */
async function violatedConstraint(insert: Promise<unknown>): Promise<string | undefined> {
  try {
    await insert;
  } catch (error) {
    const cause = (error as { cause?: { constraint?: string } }).cause;
    return cause?.constraint;
  }
  throw new Error("insert was expected to violate a constraint");
}

async function firstWorkspaceSlug(db: Db): Promise<string | undefined> {
  const [row] = await db.select({ slug: workspaces.slug }).from(workspaces).limit(1);
  return row?.slug;
}
