import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { approvalRules, commands } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

describe("Command receipts for failed commands", () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;

  beforeAll(async () => {
    testApp = await createTestApp();
    db = testApp.db;
  });

  afterAll(async () => {
    await testApp.close();
  });

  async function seedAdmin() {
    const seeded = await seedWorkspace(db);
    const member = await seedMember(db, {
      workspaceId: seeded.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    const session = await createSession(db, {
      principalId: member.principal.id,
      workspaceId: seeded.workspace.id,
    });
    return { ...seeded, token: session.token };
  }

  async function registerAsset(
    token: string,
    opts: {
      assetId?: string;
      commandId?: string;
      idempotencyKey?: string;
    } = {},
  ) {
    const assetId = opts.assetId ?? randomUUID();
    const commandId = opts.commandId ?? randomUUID();
    const idempotencyKey = opts.idempotencyKey ?? `idem-${randomUUID()}`;
    const response = await testApp.app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "register-asset",
        version: 1,
        envelope: {
          commandId,
          idempotencyKey,
          origin: "HUMAN_UI",
        },
        payload: {
          assetId,
          assetCode: `TRUCK-${randomUUID().slice(0, 8)}`,
          assetClassCode: "TRUCK",
          templateCode: "TRUCKING",
          branchCode: "DLA",
        },
      },
    });
    return { assetId, commandId, idempotencyKey, response };
  }

  it("APPROVAL_REQUIRED rejection writes REJECTED receipt with server-generated id and client_command_id", async () => {
    const seeded = await seedAdmin();

    // Delete approval rules to trigger APPROVAL_REQUIRED
    await db
      .delete(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, seeded.workspace.id),
          eq(approvalRules.commandType, "register-asset"),
        ),
      );

    const { commandId, response } = await registerAsset(seeded.token);

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("APPROVAL_REQUIRED");

    // Query receipts table for the rejected command
    const receipts = await db
      .select()
      .from(commands)
      .where(
        and(
          eq(commands.workspaceId, seeded.workspace.id),
          eq(commands.clientCommandId, commandId),
        ),
      );

    expect(receipts).toHaveLength(1);
    const receipt = receipts[0];
    if (receipt) {
      expect(receipt.status).toBe("REJECTED");
      expect(receipt.failureCode).toBe("APPROVAL_REQUIRED");
      expect(receipt.clientCommandId).toBe(commandId);
      // The receipt id should differ from the client commandId
      expect(receipt.id).not.toBe(commandId);
      // Verify the idempotency key is stored
      expect(receipt.idempotencyKey).toContain("idem-");
    }
  });

  it("After rejection, retrying with same idempotencyKey and commandId succeeds when approval is added", async () => {
    const seeded = await seedAdmin();

    // Delete approval rules to trigger APPROVAL_REQUIRED
    await db
      .delete(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, seeded.workspace.id),
          eq(approvalRules.commandType, "register-asset"),
        ),
      );

    const first = await registerAsset(seeded.token);
    expect(first.response.statusCode).toBe(403);

    // Verify REJECTED receipt was created
    let rejectedReceipts = await db
      .select()
      .from(commands)
      .where(
        and(
          eq(commands.workspaceId, seeded.workspace.id),
          eq(commands.clientCommandId, first.commandId),
        ),
      );
    expect(rejectedReceipts).toHaveLength(1);
    expect(rejectedReceipts[0]?.status).toBe("REJECTED");

    // Add approval rule to enable the command
    await db.insert(approvalRules).values({
      workspaceId: seeded.workspace.id,
      commandType: "register-asset",
      requiredRole: "ADMIN",
    });

    // Retry with same commandId and idempotencyKey
    const retry = await registerAsset(seeded.token, {
      assetId: first.assetId,
      commandId: first.commandId,
      idempotencyKey: first.idempotencyKey,
    });
    expect(retry.response.statusCode).toBe(200);
    expect(retry.response.json().idempotentReplay).toBe(false);

    // Verify EXECUTED receipt now exists with id equal to commandId
    const executedReceipts = await db
      .select()
      .from(commands)
      .where(
        and(
          eq(commands.workspaceId, seeded.workspace.id),
          eq(commands.id, first.commandId),
        ),
      );
    expect(executedReceipts).toHaveLength(1);
    if (executedReceipts[0]) {
      expect(executedReceipts[0].status).toBe("EXECUTED");
      expect(executedReceipts[0].id).toBe(first.commandId);
      expect(executedReceipts[0].clientCommandId).toBeNull();
    }

    // Original REJECTED receipt should still exist
    rejectedReceipts = await db
      .select()
      .from(commands)
      .where(
        and(
          eq(commands.workspaceId, seeded.workspace.id),
          eq(commands.clientCommandId, first.commandId),
        ),
      );
    expect(rejectedReceipts).toHaveLength(1);
  });

  it("Two consecutive rejections with same idempotency key produce two REJECTED rows", async () => {
    const seeded = await seedAdmin();

    // Delete approval rules to trigger APPROVAL_REQUIRED
    await db
      .delete(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, seeded.workspace.id),
          eq(approvalRules.commandType, "register-asset"),
        ),
      );

    const idempotencyKey = `idem-${randomUUID()}`;
    const commandId1 = randomUUID();
    const commandId2 = randomUUID();

    // First rejection
    const first = await registerAsset(seeded.token, {
      commandId: commandId1,
      idempotencyKey,
    });
    expect(first.response.statusCode).toBe(403);

    // Second rejection with same idempotency key but different commandId
    const second = await registerAsset(seeded.token, {
      commandId: commandId2,
      idempotencyKey,
    });
    expect(second.response.statusCode).toBe(403);

    // Both REJECTED receipts should exist
    const rejectedReceipts = await db
      .select()
      .from(commands)
      .where(
        and(
          eq(commands.workspaceId, seeded.workspace.id),
          eq(commands.idempotencyKey, idempotencyKey),
        ),
      );

    expect(rejectedReceipts).toHaveLength(2);
    expect(rejectedReceipts.every((r) => r.status === "REJECTED")).toBe(true);
    expect(new Set(rejectedReceipts.map((r) => r.clientCommandId))).toEqual(
      new Set([commandId1, commandId2]),
    );
  });

  it("Payload validation failure (VALIDATION_FAILED) writes REJECTED receipt", async () => {
    const seeded = await seedAdmin();

    const commandId = randomUUID();
    const idempotencyKey = `idem-${randomUUID()}`;

    const response = await testApp.app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: { authorization: `Bearer ${seeded.token}` },
      payload: {
        name: "register-asset",
        version: 1,
        envelope: {
          commandId,
          idempotencyKey,
          origin: "HUMAN_UI",
        },
        payload: {
          // Missing required field: assetCode
          assetId: randomUUID(),
          assetClassCode: "TRUCK",
          templateCode: "TRUCKING",
          branchCode: "DLA",
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");

    // Query receipts table for the validation failure
    const receipts = await db
      .select()
      .from(commands)
      .where(
        and(
          eq(commands.workspaceId, seeded.workspace.id),
          eq(commands.clientCommandId, commandId),
        ),
      );

    expect(receipts).toHaveLength(1);
    const receipt = receipts[0];
    if (receipt) {
      expect(receipt.status).toBe("REJECTED");
      expect(receipt.failureCode).toBe("VALIDATION_FAILED");
      expect(receipt.clientCommandId).toBe(commandId);
      expect(receipt.id).not.toBe(commandId);
    }
  });

  it("Successful command exact retry returns cached outcome with idempotentReplay true and only one EXECUTED row", async () => {
    const seeded = await seedAdmin();

    const assetId = randomUUID();
    const commandId = randomUUID();
    const idempotencyKey = `idem-${randomUUID()}`;
    const payload = {
      assetId,
      assetCode: `TRUCK-${randomUUID().slice(0, 8)}`,
      assetClassCode: "TRUCK",
      templateCode: "TRUCKING",
      branchCode: "DLA",
    };

    const body = {
      name: "register-asset",
      version: 1,
      envelope: {
        commandId,
        idempotencyKey,
        origin: "HUMAN_UI",
      },
      payload,
    };

    // First execution
    const response1 = await testApp.app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: { authorization: `Bearer ${seeded.token}` },
      payload: body,
    });
    expect(response1.statusCode).toBe(200);
    const result1 = response1.json();
    expect(result1.idempotentReplay).toBe(false);

    // Exact retry
    const response2 = await testApp.app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: { authorization: `Bearer ${seeded.token}` },
      payload: body,
    });
    expect(response2.statusCode).toBe(200);
    const result2 = response2.json();
    expect(result2.idempotentReplay).toBe(true);
    expect(result2.recordId).toBe(result1.recordId);
    expect(result2.commandId).toBe(commandId);

    // Verify only one EXECUTED row exists with the commandId
    const executedReceipts = await db
      .select()
      .from(commands)
      .where(
        and(
          eq(commands.workspaceId, seeded.workspace.id),
          eq(commands.id, commandId),
          eq(commands.status, "EXECUTED"),
        ),
      );

    expect(executedReceipts).toHaveLength(1);
    if (executedReceipts[0]) {
      expect(executedReceipts[0].id).toBe(commandId);
      expect(executedReceipts[0].status).toBe("EXECUTED");
    }
  });

  it("REJECTED receipts do not replay: retrying with same key after rejection re-executes", async () => {
    const seeded = await seedAdmin();

    // Delete approval rules to trigger APPROVAL_REQUIRED
    await db
      .delete(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, seeded.workspace.id),
          eq(approvalRules.commandType, "register-asset"),
        ),
      );

    const idempotencyKey = `idem-${randomUUID()}`;
    const commandId = randomUUID();

    // First attempt: rejection
    const first = await registerAsset(seeded.token, {
      commandId,
      idempotencyKey,
    });
    expect(first.response.statusCode).toBe(403);

    // Verify REJECTED receipt exists
    let rejectedReceipts = await db
      .select()
      .from(commands)
      .where(
        and(
          eq(commands.workspaceId, seeded.workspace.id),
          eq(commands.clientCommandId, commandId),
          eq(commands.status, "REJECTED"),
        ),
      );
    expect(rejectedReceipts).toHaveLength(1);

    // Add approval rule
    await db.insert(approvalRules).values({
      workspaceId: seeded.workspace.id,
      commandType: "register-asset",
      requiredRole: "ADMIN",
    });

    // Retry with SAME commandId and idempotencyKey — should re-execute, not return cached rejection
    const retry = await registerAsset(seeded.token, {
      assetId: first.assetId,
      commandId,
      idempotencyKey,
    });
    expect(retry.response.statusCode).toBe(200);

    // The idempotentReplay should be false because the REJECTED receipt doesn't count as a replay
    expect(retry.response.json().idempotentReplay).toBe(false);

    // Verify EXECUTED receipt now exists with same commandId
    const executedReceipts = await db
      .select()
      .from(commands)
      .where(
        and(
          eq(commands.workspaceId, seeded.workspace.id),
          eq(commands.id, commandId),
          eq(commands.status, "EXECUTED"),
        ),
      );
    expect(executedReceipts).toHaveLength(1);

    // Original REJECTED receipt should still exist (separate row with server-generated id)
    rejectedReceipts = await db
      .select()
      .from(commands)
      .where(
        and(
          eq(commands.workspaceId, seeded.workspace.id),
          eq(commands.clientCommandId, commandId),
          eq(commands.status, "REJECTED"),
        ),
      );
    expect(rejectedReceipts).toHaveLength(1);
  });
});
