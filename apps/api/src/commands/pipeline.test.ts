import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { createTestApp } from "../test/fixture.js";
import { seedWorkspace, seedMember } from "../test/seed.js";
import { createSession } from "../auth/local.js";
import { approvalRules, assets, commands, auditEvents, workspaces } from "../db/schema.js";
import { registerCommand } from "./dispatcher.js";
import { buildServer } from "../server.js";
import type { Db } from "../db/client.js";

describe("Command Pipeline", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let app: Awaited<ReturnType<typeof createTestApp>>["app"];
  let db: Db;
  let workspace: Awaited<ReturnType<typeof seedWorkspace>>["workspace"];
  let branch: Awaited<ReturnType<typeof seedWorkspace>>["branch"];
  let principal: Awaited<ReturnType<typeof seedMember>>["principal"];
  let token: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    db = ctx.db;

    const seeded = await seedWorkspace(db);
    workspace = seeded.workspace;
    branch = seeded.branch;

    const member = await seedMember(db, {
      workspaceId: workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    principal = member.principal;

    const session = await createSession(db, {
      principalId: principal.id,
      workspaceId: workspace.id,
    });
    token = session.token;
  });

  afterAll(async () => {
    await ctx.close();
  });

  const postCommand = async (body: unknown, authToken?: string) => {
    return app.inject({
      method: "POST",
      url: "/v1/commands",
      payload: body as object,
      headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
    });
  };

  describe("Happy path", () => {
    it("should register asset and return 200 with correct fields", async () => {
      const assetId = randomUUID();
      const commandId = randomUUID();
      const idempotencyKey = `idem-${randomUUID()}`;

      const response = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId,
            idempotencyKey,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
            assetCode: "TRUCK-001",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
        token
      );

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.commandId).toBe(commandId);
      expect(body.recordId).toBe(assetId);
      expect(body.rowVersion).toBe(1);
      expect(body.warnings).toEqual([]);
      expect(body.idempotentReplay).toBe(false);

      const [row] = await db.select().from(assets).where(eq(assets.id, assetId));
      expect(row).toMatchObject({
        id: assetId,
        workspaceId: workspace.id,
        branchId: branch.id,
        assetCode: "TRUCK-001",
        lifecycleStatus: "REGISTERED",
        rowVersion: 1,
        createdByCommandId: commandId,
      });
    });
  });

  describe("Idempotency", () => {
    it("exact retry with same payload returns 200 with idempotentReplay true", async () => {
      const assetId = randomUUID();
      const commandId = randomUUID();
      const idempotencyKey = `idem-${randomUUID()}`;
      const payload = {
        assetId,
        assetCode: "TRUCK-002",
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

      const response1 = await postCommand(body, token);
      expect(response1.statusCode).toBe(200);
      const result1 = JSON.parse(response1.body);
      const recordId1 = result1.recordId;

      const response2 = await postCommand(body, token);
      expect(response2.statusCode).toBe(200);
      const result2 = JSON.parse(response2.body);
      expect(result2.recordId).toBe(recordId1);
      expect(result2.idempotentReplay).toBe(true);

      const rows = await db
        .select()
        .from(assets)
        .where(and(eq(assets.workspaceId, workspace.id), eq(assets.assetCode, "TRUCK-002")));
      expect(rows).toHaveLength(1);
    });

    it("same idempotencyKey with different payload returns 409 IDEMPOTENCY_KEY_REUSED", async () => {
      const idempotencyKey = `idem-${randomUUID()}`;
      const commandId1 = randomUUID();
      const assetId1 = randomUUID();

      const body1 = {
        name: "register-asset",
        version: 1,
        envelope: {
          commandId: commandId1,
          idempotencyKey,
          origin: "HUMAN_UI",
        },
        payload: {
          assetId: assetId1,
          assetCode: "TRUCK-003",
          assetClassCode: "TRUCK",
          templateCode: "TRUCKING",
          branchCode: "DLA",
        },
      };

      const response1 = await postCommand(body1, token);
      expect(response1.statusCode).toBe(200);

      const body2 = {
        name: "register-asset",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey,
          origin: "HUMAN_UI",
        },
        payload: {
          assetId: randomUUID(),
          assetCode: "TRUCK-004",
          assetClassCode: "TRUCK",
          templateCode: "TRUCKING",
          branchCode: "DLA",
        },
      };

      const response2 = await postCommand(body2, token);
      expect(response2.statusCode).toBe(409);
      const errorBody = JSON.parse(response2.body);
      expect(errorBody.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
      // Assert no "message" property anywhere in the response
      const responseStr = JSON.stringify(errorBody);
      expect(responseStr).not.toMatch(/"message":/);
    });
  });

  describe("Authorization", () => {
    it("role not allowed returns 403 ROLE_FORBIDDEN", async () => {
      const member = await seedMember(db, {
        workspaceId: workspace.id,
        role: "EXECUTIVE_VIEWER",
      });
      const session = await createSession(db, {
        principalId: member.principal.id,
        workspaceId: workspace.id,
      });

      const response = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey: `idem-${randomUUID()}`,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId: randomUUID(),
            assetCode: "TRUCK-005",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
        session.token
      );

      expect(response.statusCode).toBe(403);
      const errorBody = JSON.parse(response.body);
      expect(errorBody.error.code).toBe("ROLE_FORBIDDEN");
    });
  });

  describe("Validation", () => {
    it("invalid payload returns 400 with VALIDATION_FAILED and issues array", async () => {
      const response = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey: `idem-${randomUUID()}`,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId: randomUUID(),
            // missing assetCode — validation should fail
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
        token
      );

      expect(response.statusCode).toBe(400);
      const errorBody = JSON.parse(response.body);
      expect(errorBody.error.code).toBe("VALIDATION_FAILED");
      expect(Array.isArray(errorBody.error.metadata.issues)).toBe(true);
      expect(errorBody.error.metadata.issues.length).toBeGreaterThan(0);
      // Each issue should have path and code
      for (const issue of errorBody.error.metadata.issues) {
        expect(issue).toHaveProperty("path");
        expect(issue).toHaveProperty("code");
      }
      // Assert no "message" field anywhere in response
      const responseStr = JSON.stringify(errorBody);
      expect(responseStr).not.toMatch(/"message":/);
    });
  });

  describe("Command lookup", () => {
    it("unknown command name returns 404 COMMAND_NOT_FOUND", async () => {
      const response = await postCommand(
        {
          name: "unknown-command-xyz",
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey: `idem-${randomUUID()}`,
            origin: "HUMAN_UI",
          },
          payload: {},
        },
        token
      );

      expect(response.statusCode).toBe(404);
      const errorBody = JSON.parse(response.body);
      expect(errorBody.error.code).toBe("COMMAND_NOT_FOUND");
    });
  });

  describe("Business constraints", () => {
    it("unknown branch code returns 422 REFERENCE_NOT_FOUND", async () => {
      const response = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey: `idem-${randomUUID()}`,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId: randomUUID(),
            assetCode: "TRUCK-006",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "INVALID_BRANCH",
          },
        },
        token
      );

      expect(response.statusCode).toBe(422);
      const errorBody = JSON.parse(response.body);
      expect(errorBody.error.code).toBe("REFERENCE_NOT_FOUND");
    });

    it("duplicate asset code in same workspace returns 409 DUPLICATE_ASSET_CODE", async () => {
      const assetCode = `TRUCK-${randomUUID().substring(0, 8)}`;

      const body1 = {
        name: "register-asset",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: {
          assetId: randomUUID(),
          assetCode,
          assetClassCode: "TRUCK",
          templateCode: "TRUCKING",
          branchCode: "DLA",
        },
      };

      const response1 = await postCommand(body1, token);
      expect(response1.statusCode).toBe(200);

      const body2 = {
        name: "register-asset",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: {
          assetId: randomUUID(),
          assetCode,
          assetClassCode: "TRUCK",
          templateCode: "TRUCKING",
          branchCode: "DLA",
        },
      };

      const response2 = await postCommand(body2, token);
      expect(response2.statusCode).toBe(409);
      const errorBody = JSON.parse(response2.body);
      expect(errorBody.error.code).toBe("DUPLICATE_ASSET_CODE");
    });

    it("duplicate asset code in different workspace succeeds", async () => {
      const assetCode = `TRUCK-${randomUUID().substring(0, 8)}`;

      // Register in first workspace
      const response1 = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey: `idem-${randomUUID()}`,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId: randomUUID(),
            assetCode,
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
        token
      );
      expect(response1.statusCode).toBe(200);

      // Create second workspace
      const workspace2 = await seedWorkspace(db);
      const member2 = await seedMember(db, {
        workspaceId: workspace2.workspace.id,
        role: "ADMIN",
        branchIds: [workspace2.branch.id],
      });
      const session2 = await createSession(db, {
        principalId: member2.principal.id,
        workspaceId: workspace2.workspace.id,
      });

      // Register same assetCode in second workspace
      const response2 = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey: `idem-${randomUUID()}`,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId: randomUUID(),
            assetCode,
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: workspace2.branch.code,
          },
        },
        session2.token
      );

      expect(response2.statusCode).toBe(200);
    });
  });

  describe("Authentication", () => {
    it("unauthenticated POST returns 401 AUTH_REQUIRED", async () => {
      const response = await postCommand({
        name: "register-asset",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: {
          assetId: randomUUID(),
          assetCode: "TRUCK-007",
          assetClassCode: "TRUCK",
          templateCode: "TRUCKING",
          branchCode: "DLA",
        },
      });

      expect(response.statusCode).toBe(401);
      const errorBody = JSON.parse(response.body);
      expect(errorBody.error.code).toBe("AUTH_REQUIRED");
    });
  });

  describe("Tenant isolation", () => {
    it("forged tenant fields in envelope and payload are stripped by zod", async () => {
      const assetId = randomUUID();
      const commandId = randomUUID();
      const idempotencyKey = `idem-${randomUUID()}`;

      const response = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId,
            idempotencyKey,
            origin: "HUMAN_UI",
            workspaceId: randomUUID(), // forged
            actorId: randomUUID(), // forged
          },
          payload: {
            assetId,
            assetCode: "TRUCK-008",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
        token
      );

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body);
      expect(responseBody.recordId).toBe(assetId);

      // Verify receipt was created in correct workspace
      const receipts = await db
        .select()
        .from(commands)
        .where(eq(commands.id, commandId));
      expect(receipts).toHaveLength(1);
      if (receipts[0]) {
        expect(receipts[0].workspaceId).toBe(workspace.id);
      }
    });
  });

  describe("Record tracking", () => {
    it("receipt row is created correctly in commands table", async () => {
      const assetId = randomUUID();
      const commandId = randomUUID();
      const idempotencyKey = `idem-${randomUUID()}`;
      const payload = {
        assetId,
        assetCode: "TRUCK-009",
        assetClassCode: "TRUCK",
        templateCode: "TRUCKING",
        branchCode: "DLA",
      };

      const response = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId,
            idempotencyKey,
            origin: "HUMAN_UI",
          },
          payload,
        },
        token
      );

      expect(response.statusCode).toBe(200);

      const receipts = await db
        .select()
        .from(commands)
        .where(eq(commands.id, commandId));
      expect(receipts).toHaveLength(1);
      const receipt = receipts[0];
      if (receipt) {
        expect(receipt.status).toBe("EXECUTED");
        expect(receipt.initiatedByPrincipalId).toBe(principal.id);
        expect(receipt.origin).toBe("HUMAN_UI");
        expect(receipt.idempotencyKey).toBe(idempotencyKey);
        expect(receipt.payload).toEqual(payload);
        const result = receipt.result as any;
        expect(result?.recordId).toBe(assetId);
      }
    });

    it("audit event row is created correctly in auditEvents table", async () => {
      const assetId = randomUUID();
      const commandId = randomUUID();
      const idempotencyKey = `idem-${randomUUID()}`;

      const response = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId,
            idempotencyKey,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
            assetCode: "TRUCK-010",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
        token
      );

      expect(response.statusCode).toBe(200);

      const events = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.commandId, commandId));
      expect(events).toHaveLength(1);
      const event = events[0];
      if (event) {
        expect(event.commandId).toBe(commandId);
        expect(event.eventType).toBe("asset.registered");
        expect(event.actorPrincipalId).toBe(principal.id);
        expect(event.entityType).toBe("asset");
        expect(event.entityId).toBe(assetId);
        expect(event.beforeState).toBeNull();
        expect(event.afterState).toBeTruthy();
        expect(Array.isArray(event.changedFields)).toBe(true);
        expect((event.changedFields ?? []).length).toBeGreaterThan(0);
      }
    });
  });

  describe("Atomicity", () => {
    it("a mid-transaction failure leaves no partial state — not even earlier writes", async () => {
      const commandId = randomUUID();

      registerCommand({
        name: "test-explode",
        version: 1,
        module: "CORE",
        allowedRoles: ["ADMIN"],
        payloadSchema: z.object({}),
        branchAuthorization: { kind: "workspace" },
        execute: async (tx, _ctx, envelope) => {
          await tx
            .insert(workspaces)
            .values({ slug: `explode-${envelope.commandId}`, name: "explode" });
          throw new Error("boom");
        },
      });

      await db.insert(approvalRules).values({
        workspaceId: workspace.id,
        commandType: "test-explode",
        requiredRole: "ADMIN",
      });

      const response = await postCommand(
        {
          name: "test-explode",
          version: 1,
          envelope: {
            commandId,
            idempotencyKey: `idem-${randomUUID()}`,
            origin: "HUMAN_UI",
          },
          payload: {},
        },
        token
      );

      expect(response.statusCode).toBe(500);
      const errorBody = JSON.parse(response.body);
      expect(errorBody.error.code).toBe("COMMAND_FAILED");
      expect(JSON.stringify(errorBody)).not.toMatch(/"message":/);

      const orphans = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.slug, `explode-${commandId}`));
      expect(orphans).toHaveLength(0);

      const receipts = await db
        .select()
        .from(commands)
        .where(eq(commands.id, commandId));
      expect(receipts).toHaveLength(0);
    });
  });

  describe("Logging", () => {
    it("every request log line carries commandId and workspaceId", async () => {
      const lines: string[] = [];
      const logApp = buildServer({
        db,
        logger: {
          level: "info",
          stream: {
            write(line: string) {
              lines.push(line);
            },
          },
        },
      });
      await logApp.ready();

      const assetId = randomUUID();
      const commandId = randomUUID();
      const response = await logApp.inject({
        method: "POST",
        url: "/v1/commands",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId,
            idempotencyKey: `idem-${randomUUID()}`,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId,
            assetCode: "TRUCK-011",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
      });
      expect(response.statusCode).toBe(200);
      await logApp.close();

      const requestLines = lines
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is Record<string, unknown> => entry !== null)
        .filter((entry) => entry["reqId"] !== undefined && entry["msg"] !== "incoming request");
      expect(requestLines.length).toBeGreaterThan(0);
      for (const entry of requestLines) {
        expect(entry["commandId"]).toBe(commandId);
        expect(entry["workspaceId"]).toBe(workspace.id);
      }
    });
  });
});
