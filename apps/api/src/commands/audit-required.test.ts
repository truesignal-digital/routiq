import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { resolveOperatorContext } from "../auth/context.js";
import type { AuthContext, OperatorContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import { platformDb, type PlatformDb } from "../db/platform.js";
import {
  approvalRules,
  assets,
  auditEvents,
  branches,
  commands,
  principals,
  workspaces,
} from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import {
  appendAuditEvent,
  appendPlatformAuditEvent,
  dispatchCommand,
  registerCommand,
  registerPlatformCommand,
  type CommandLog,
  type Tx,
} from "./dispatcher.js";

/**
 * #153: the dispatcher, not each handler's memory, guarantees that a committed
 * command left an audit event. These handlers are planted bugs: each writes a
 * business row and then forgets, misattributes or mis-scopes its audit event.
 */
const assetPayload = z.strictObject({ assetId: z.uuid(), assetCode: z.string(), branchId: z.uuid() });
type AssetPayload = z.infer<typeof assetPayload>;

function insertAsset(tx: Tx, workspaceId: string, commandId: string, payload: AssetPayload) {
  return tx.insert(assets).values({
    id: payload.assetId,
    workspaceId,
    branchId: payload.branchId,
    assetCode: payload.assetCode,
    assetClassCode: "TRUCK",
    templateCode: "TRUCKING",
    createdByCommandId: commandId,
  });
}

const workspaceCommandBase = {
  module: "CORE",
  allowedRoles: ["ADMIN"],
  payloadSchema: assetPayload,
  branchAuthorization: { kind: "workspace" },
} as const;

registerCommand<AssetPayload>({
  ...workspaceCommandBase,
  name: "test-unaudited",
  version: 1,
  execute: async (tx, ctx, envelope, payload) => {
    await insertAsset(tx, ctx.workspaceId, envelope.commandId, payload);
    return { recordId: payload.assetId, rowVersion: 1 };
  },
});

/** Audits, but under an earlier command's id: an event exists, just not this command's. */
let borrowedCommandId = "";
registerCommand<AssetPayload>({
  ...workspaceCommandBase,
  name: "test-misattributed-audit",
  version: 1,
  execute: async (tx, ctx, envelope, payload) => {
    await insertAsset(tx, ctx.workspaceId, envelope.commandId, payload);
    await appendAuditEvent(tx, ctx, { ...envelope, commandId: borrowedCommandId }, {
      eventType: "asset.registered",
      entityType: "asset",
      entityId: payload.assetId,
    });
    return { recordId: payload.assetId, rowVersion: 1 };
  },
});

/** Audits its own command id, but on the platform trail instead of the workspace's. */
registerCommand<AssetPayload>({
  ...workspaceCommandBase,
  name: "test-wrong-scope-audit",
  version: 1,
  execute: async (tx, ctx, envelope, payload) => {
    await insertAsset(tx, ctx.workspaceId, envelope.commandId, payload);
    const asOperator: OperatorContext = {
      kind: "platform",
      principalId: ctx.principalId,
      principalType: "VENDOR_OPERATOR",
      displayName: "planted",
    };
    await appendPlatformAuditEvent(tx, asOperator, ctx.workspaceId, envelope, {
      eventType: "asset.registered",
      entityType: "asset",
      entityId: payload.assetId,
    });
    return { recordId: payload.assetId, rowVersion: 1 };
  },
});

registerCommand<AssetPayload>({
  ...workspaceCommandBase,
  name: "test-audited",
  version: 1,
  execute: async (tx, ctx, envelope, payload) => {
    await insertAsset(tx, ctx.workspaceId, envelope.commandId, payload);
    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "asset.registered",
      entityType: "asset",
      entityId: payload.assetId,
    });
    return { recordId: payload.assetId, rowVersion: 1 };
  },
});

/** Changes nothing but still says so in the trail: a legitimate success. */
registerCommand<AssetPayload>({
  ...workspaceCommandBase,
  name: "test-audited-noop",
  version: 1,
  execute: async (tx, ctx, envelope, payload) => {
    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "asset.unchanged",
      entityType: "asset",
      entityId: payload.assetId,
    });
    return { recordId: payload.assetId, rowVersion: 1 };
  },
});

const provisionPayload = z.strictObject({ workspaceId: z.uuid(), branchId: z.uuid(), slug: z.string() });
type ProvisionPayload = z.infer<typeof provisionPayload>;

function provisionCommand(name: string, audited: boolean) {
  registerPlatformCommand<ProvisionPayload>({
    scope: "platform",
    name,
    version: 1,
    payloadSchema: provisionPayload,
    resolveWorkspace: async (tx, _ctx, _envelope, payload) => {
      await tx.insert(workspaces).values({ id: payload.workspaceId, slug: payload.slug, name: payload.slug });
      return payload.workspaceId;
    },
    execute: async (tx, ctx, envelope, payload, workspaceId) => {
      await tx.insert(branches).values({ id: payload.branchId, workspaceId, code: "DLA", name: "Douala" });
      if (audited) {
        await appendPlatformAuditEvent(tx, ctx, workspaceId, envelope, {
          eventType: "workspace.provisioned",
          entityType: "workspace",
          entityId: workspaceId,
        });
      }
      return { recordId: workspaceId, rowVersion: 1 };
    },
  });
}
provisionCommand("test-provision-audited", true);
provisionCommand("test-provision-unaudited", false);

describe("a successful command must leave an audit event (#153)", () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let platform: PlatformDb;
  let operator: OperatorContext;
  let tenant: AuthContext;
  let branchId: string;

  beforeAll(async () => {
    testApp = await createTestApp();
    db = testApp.db;
    platform = platformDb(db);

    const seeded = await seedWorkspace(db);
    branchId = seeded.branch.id;
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
    await db.insert(approvalRules).values(
      [
        "test-unaudited",
        "test-misattributed-audit",
        "test-wrong-scope-audit",
        "test-audited",
        "test-audited-noop",
      ].map((commandType) => ({ workspaceId: tenant.workspaceId, commandType, requiredRole: "ADMIN" as const })),
    );

    const [row] = await db
      .insert(principals)
      .values({ principalType: "VENDOR_OPERATOR", displayName: "vendor-cli" })
      .returning();
    if (!row) throw new Error("operator principal insert returned no row");
    const resolved = await resolveOperatorContext(db, row.id);
    if (!resolved) throw new Error("operator context did not resolve");
    operator = resolved;
  });

  afterAll(async () => {
    await testApp.close();
  });

  function workspaceBody(name: string, overrides: { commandId?: string; idempotencyKey?: string } = {}) {
    const assetId = randomUUID();
    return {
      name,
      version: 1,
      envelope: {
        commandId: overrides.commandId ?? randomUUID(),
        idempotencyKey: overrides.idempotencyKey ?? `idem-${randomUUID()}`,
        origin: "HUMAN_UI",
      },
      payload: { assetId, assetCode: `T-${assetId.slice(0, 8)}`, branchId },
    };
  }

  function provisionBody(name: string) {
    const workspaceId = randomUUID();
    return {
      name,
      version: 1,
      envelope: { commandId: randomUUID(), idempotencyKey: `idem-${randomUUID()}`, origin: "API" },
      payload: { workspaceId, branchId: randomUUID(), slug: `ws-${workspaceId.slice(0, 8)}` },
    };
  }

  function collectingLog() {
    const errors: object[] = [];
    const log: CommandLog = { error: (obj) => errors.push(obj) };
    return { log, errors };
  }

  async function auditEventsFor(commandId: string) {
    return db.select().from(auditEvents).where(eq(auditEvents.commandId, commandId));
  }

  async function receiptsFor(commandId: string) {
    const executed = await db.select().from(commands).where(eq(commands.id, commandId));
    const failures = await db.select().from(commands).where(eq(commands.clientCommandId, commandId));
    return { executed, failures };
  }

  async function expectRolledBack(body: ReturnType<typeof workspaceBody>) {
    const commandId = body.envelope.commandId;
    expect(await db.select().from(assets).where(eq(assets.id, body.payload.assetId))).toHaveLength(0);
    expect(await auditEventsFor(commandId)).toHaveLength(0);
    const { executed, failures } = await receiptsFor(commandId);
    expect(executed).toHaveLength(0);
    // The debugging trail survives, and says the command did not happen.
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ status: "FAILED", failureCode: "AUDIT_EVENT_MISSING" });
  }

  describe("workspace commands", () => {
    it("refuses a handler that writes a row and no audit event, and keeps nothing it wrote", async () => {
      // An earlier command's event already sits in this workspace's trail; it must not count.
      const earlier = workspaceBody("test-audited");
      expect((await dispatchCommand(testApp.runtimeDb, tenant, earlier)).status).toBe(200);
      expect(await auditEventsFor(earlier.envelope.commandId)).toHaveLength(1);

      const body = workspaceBody("test-unaudited");
      const { log, errors } = collectingLog();
      const result = await dispatchCommand(testApp.runtimeDb, tenant, body, log);

      expect(result).toEqual({ status: 500, body: { error: { code: "AUDIT_EVENT_MISSING" } } });
      await expectRolledBack(body);
      expect(errors).toEqual([
        expect.objectContaining({ event: "command.failed" }),
      ]);
    });

    it("refuses an audit event filed under another command's id", async () => {
      const earlier = workspaceBody("test-audited");
      expect((await dispatchCommand(testApp.runtimeDb, tenant, earlier)).status).toBe(200);
      borrowedCommandId = earlier.envelope.commandId;

      const body = workspaceBody("test-misattributed-audit");
      const result = await dispatchCommand(testApp.runtimeDb, tenant, body);

      expect(result).toEqual({ status: 500, body: { error: { code: "AUDIT_EVENT_MISSING" } } });
      await expectRolledBack(body);
      // The misfiled event rolled back with everything else.
      expect(await auditEventsFor(earlier.envelope.commandId)).toHaveLength(1);
    });

    it("refuses an audit event on the platform trail for a workspace command", async () => {
      const body = workspaceBody("test-wrong-scope-audit");
      const result = await dispatchCommand(testApp.runtimeDb, tenant, body);

      expect(result).toEqual({ status: 500, body: { error: { code: "AUDIT_EVENT_MISSING" } } });
      await expectRolledBack(body);
    });

    it("commits an audited command, and replays it without writing again", async () => {
      const body = workspaceBody("test-audited");
      const first = await dispatchCommand(testApp.runtimeDb, tenant, body);
      expect(first).toMatchObject({ status: 200, body: { idempotentReplay: false } });

      const replay = await dispatchCommand(testApp.runtimeDb, tenant, body);
      expect(replay).toMatchObject({ status: 200, body: { idempotentReplay: true, recordId: body.payload.assetId } });

      expect(await db.select().from(assets).where(eq(assets.id, body.payload.assetId))).toHaveLength(1);
      expect(await auditEventsFor(body.envelope.commandId)).toHaveLength(1);
      const { executed, failures } = await receiptsFor(body.envelope.commandId);
      expect(executed).toHaveLength(1);
      expect(executed[0]?.status).toBe("EXECUTED");
      expect(failures).toHaveLength(0);
    });

    it("commits an audited no-op", async () => {
      const body = workspaceBody("test-audited-noop");
      const result = await dispatchCommand(testApp.runtimeDb, tenant, body);
      expect(result).toMatchObject({ status: 200, body: { idempotentReplay: false } });
      expect(await auditEventsFor(body.envelope.commandId)).toHaveLength(1);
    });

    it("lets a corrected retry under the same key succeed after the refusal", async () => {
      const idempotencyKey = `idem-${randomUUID()}`;
      const refused = workspaceBody("test-unaudited", { idempotencyKey });
      expect((await dispatchCommand(testApp.runtimeDb, tenant, refused)).status).toBe(500);

      // The FAILED receipt never consumed the key, so a fixed handler can still run.
      const retried = workspaceBody("test-audited", { idempotencyKey });
      const result = await dispatchCommand(testApp.runtimeDb, tenant, retried);
      expect(result).toMatchObject({ status: 200, body: { idempotentReplay: false } });
    });
  });

  describe("platform commands", () => {
    it("refuses an unaudited provisioning and rolls back the workspace, its rows and the receipt", async () => {
      // A preexisting platform event from another command must not satisfy the check.
      const earlier = provisionBody("test-provision-audited");
      expect((await dispatchCommand(platform, operator, earlier)).status).toBe(200);
      expect(await auditEventsFor(earlier.envelope.commandId)).toHaveLength(1);

      const body = provisionBody("test-provision-unaudited");
      const { log, errors } = collectingLog();
      const result = await dispatchCommand(platform, operator, body, log);

      expect(result).toEqual({ status: 500, body: { error: { code: "AUDIT_EVENT_MISSING" } } });
      expect(await db.select().from(workspaces).where(eq(workspaces.id, body.payload.workspaceId))).toHaveLength(0);
      expect(await db.select().from(branches).where(eq(branches.id, body.payload.branchId))).toHaveLength(0);
      const { executed, failures } = await receiptsFor(body.envelope.commandId);
      expect(executed).toHaveLength(0);
      expect(failures).toHaveLength(0);
      expect(await auditEventsFor(body.envelope.commandId)).toHaveLength(0);
      expect(errors).toEqual([
        expect.objectContaining({ event: "command.failed" }),
      ]);
    });

    it("commits an audited provisioning, and replays it without writing again", async () => {
      const body = provisionBody("test-provision-audited");
      expect(await dispatchCommand(platform, operator, body)).toMatchObject({
        status: 200,
        body: { idempotentReplay: false },
      });
      expect(await dispatchCommand(platform, operator, body)).toMatchObject({
        status: 200,
        body: { idempotentReplay: true },
      });
      const events = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.commandId, body.envelope.commandId), eq(auditEvents.scope, "PLATFORM")));
      expect(events).toHaveLength(1);
    });
  });
});
