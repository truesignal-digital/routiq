import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createTestApp } from "../test/fixture.js";
import { seedWorkspace, seedMember } from "../test/seed.js";
import { createSession } from "../auth/local.js";
import {
  workspaceModules,
  auditEvents,
  assets,
} from "../db/schema.js";
import type { Db } from "../db/client.js";

describe("Module Entitlement Commands", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let app: Awaited<ReturnType<typeof createTestApp>>["app"];
  let db: Db;
  let workspaceAId: string;
  let workspaceBId: string;
  let branchAId: string;
  let branchBId: string;
  let adminPrincipalId: string;
  let opsManagerPrincipalId: string;
  let adminToken: string;
  let opsManagerToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    db = ctx.db;

    // Seed workspace A
    const seededA = await seedWorkspace(db);
    workspaceAId = seededA.workspace.id;
    branchAId = seededA.branch.id;

    // Seed workspace B
    const seededB = await seedWorkspace(db);
    workspaceBId = seededB.workspace.id;
    branchBId = seededB.branch.id;

    // Seed ADMIN member in workspace A
    const adminMember = await seedMember(db, {
      workspaceId: workspaceAId,
      role: "ADMIN",
      allBranches: true,
    });
    adminPrincipalId = adminMember.principal.id;
    const adminSession = await createSession(db, {
      principalId: adminPrincipalId,
      workspaceId: workspaceAId,
    });
    adminToken = adminSession.token;

    // Seed OPS_MANAGER member in workspace A
    const opsManagerMember = await seedMember(db, {
      workspaceId: workspaceAId,
      role: "OPS_MANAGER",
      allBranches: true,
    });
    opsManagerPrincipalId = opsManagerMember.principal.id;
    const opsManagerSession = await createSession(db, {
      principalId: opsManagerPrincipalId,
      workspaceId: workspaceAId,
    });
    opsManagerToken = opsManagerSession.token;
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

  describe("Disable module", () => {
    it("should disable ASSETS module and prevent register-asset", async () => {
      // Step 1: RegisterAsset should succeed (ASSETS enabled by default — no row)
      const asset1Id = randomUUID();
      const registerAssetCommand1 = randomUUID();
      const registerAssetKey1 = `idem-${randomUUID()}`;

      const registerResp1 = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: registerAssetCommand1,
            idempotencyKey: registerAssetKey1,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId: asset1Id,
            assetCode: "TRUCK-001",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
        adminToken
      );

      expect(registerResp1.statusCode).toBe(200);
      const registerBody1 = JSON.parse(registerResp1.body);
      expect(registerBody1.recordId).toBe(asset1Id);

      // Verify asset was created
      const [asset1] = await db
        .select()
        .from(assets)
        .where(eq(assets.id, asset1Id));
      expect(asset1).toBeDefined();
      expect(asset1!.assetCode).toBe("TRUCK-001");

      // Step 2: Disable ASSETS module
      const disableCommandId = randomUUID();
      const disableKey = `idem-${randomUUID()}`;

      const disableResp = await postCommand(
        {
          name: "disable-module",
          version: 1,
          envelope: {
            commandId: disableCommandId,
            idempotencyKey: disableKey,
            origin: "HUMAN_UI",
          },
          payload: {
            moduleCode: "ASSETS",
          },
        },
        adminToken
      );

      expect(disableResp.statusCode).toBe(200);
      const disableBody = JSON.parse(disableResp.body);
      expect(disableBody.commandId).toBe(disableCommandId);
      expect(disableBody.recordId).toBeDefined();
      expect(disableBody.rowVersion).toBe(1);

      // Verify workspace_modules row exists with enabled=false
      const [moduleRow] = await db
        .select()
        .from(workspaceModules)
        .where(
          and(
            eq(workspaceModules.workspaceId, workspaceAId),
            eq(workspaceModules.moduleCode, "ASSETS")
          )
        );
      expect(moduleRow).toBeDefined();
      expect(moduleRow!.enabled).toBe(false);
      expect(moduleRow!.updatedByCommandId).toBe(disableCommandId);

      // Verify audit event exists
      const [auditEvent] = await db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.commandId, disableCommandId),
            eq(auditEvents.eventType, "module.disabled")
          )
        );
      expect(auditEvent).toBeDefined();
      expect(auditEvent!.entityType).toBe("workspace_module");
      expect(auditEvent!.entityId).toBe(moduleRow!.id);

      // Step 3: RegisterAsset should fail with MODULE_DISABLED
      const asset2Id = randomUUID();
      const registerAssetCommand2 = randomUUID();
      const registerAssetKey2 = `idem-${randomUUID()}`;

      const registerResp2 = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: registerAssetCommand2,
            idempotencyKey: registerAssetKey2,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId: asset2Id,
            assetCode: "TRUCK-002",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
        adminToken
      );

      expect(registerResp2.statusCode).toBe(403);
      const registerErrorBody = JSON.parse(registerResp2.body);
      expect(registerErrorBody.error.code).toBe("MODULE_DISABLED");
      expect(registerErrorBody.error.metadata.module).toBe("ASSETS");

      // Verify asset was NOT created
      const [asset2] = await db
        .select()
        .from(assets)
        .where(eq(assets.id, asset2Id));
      expect(asset2).toBeUndefined();
    });

    it("should enable module and restore functionality", async () => {
      // Step 4: Enable ASSETS module
      const enableCommandId = randomUUID();
      const enableKey = `idem-${randomUUID()}`;

      const enableResp = await postCommand(
        {
          name: "enable-module",
          version: 1,
          envelope: {
            commandId: enableCommandId,
            idempotencyKey: enableKey,
            origin: "HUMAN_UI",
          },
          payload: {
            moduleCode: "ASSETS",
          },
        },
        adminToken
      );

      expect(enableResp.statusCode).toBe(200);
      const enableBody = JSON.parse(enableResp.body);
      expect(enableBody.commandId).toBe(enableCommandId);
      expect(enableBody.rowVersion).toBe(2);

      // Verify workspace_modules row has enabled=true and rowVersion incremented
      const [moduleRow] = await db
        .select()
        .from(workspaceModules)
        .where(
          and(
            eq(workspaceModules.workspaceId, workspaceAId),
            eq(workspaceModules.moduleCode, "ASSETS")
          )
        );
      expect(moduleRow).toBeDefined();
      expect(moduleRow!.enabled).toBe(true);
      expect(moduleRow!.rowVersion).toBe(2);

      // Step 5: RegisterAsset should succeed again
      const asset3Id = randomUUID();
      const registerAssetCommand3 = randomUUID();
      const registerAssetKey3 = `idem-${randomUUID()}`;

      const registerResp3 = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: registerAssetCommand3,
            idempotencyKey: registerAssetKey3,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId: asset3Id,
            assetCode: "TRUCK-003",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
        adminToken
      );

      expect(registerResp3.statusCode).toBe(200);
      const registerBody3 = JSON.parse(registerResp3.body);
      expect(registerBody3.recordId).toBe(asset3Id);

      // Verify asset was created
      const [asset3] = await db
        .select()
        .from(assets)
        .where(eq(assets.id, asset3Id));
      expect(asset3).toBeDefined();
      expect(asset3!.assetCode).toBe("TRUCK-003");
    });
  });

  describe("Authorization", () => {
    it("should reject disable-module for non-ADMIN role", async () => {
      const disableCommandId = randomUUID();
      const disableKey = `idem-${randomUUID()}`;

      const disableResp = await postCommand(
        {
          name: "disable-module",
          version: 1,
          envelope: {
            commandId: disableCommandId,
            idempotencyKey: disableKey,
            origin: "HUMAN_UI",
          },
          payload: {
            moduleCode: "ASSETS",
          },
        },
        opsManagerToken
      );

      expect(disableResp.statusCode).toBe(403);
      const errorBody = JSON.parse(disableResp.body);
      expect(errorBody.error.code).toBe("ROLE_FORBIDDEN");
    });

    it("should reject enable-module for non-ADMIN role", async () => {
      const enableCommandId = randomUUID();
      const enableKey = `idem-${randomUUID()}`;

      const enableResp = await postCommand(
        {
          name: "enable-module",
          version: 1,
          envelope: {
            commandId: enableCommandId,
            idempotencyKey: enableKey,
            origin: "HUMAN_UI",
          },
          payload: {
            moduleCode: "ASSETS",
          },
        },
        opsManagerToken
      );

      expect(enableResp.statusCode).toBe(403);
      const errorBody = JSON.parse(enableResp.body);
      expect(errorBody.error.code).toBe("ROLE_FORBIDDEN");
    });
  });

  describe("Validation", () => {
    it("should reject disable-module with CORE moduleCode", async () => {
      const disableCommandId = randomUUID();
      const disableKey = `idem-${randomUUID()}`;

      const disableResp = await postCommand(
        {
          name: "disable-module",
          version: 1,
          envelope: {
            commandId: disableCommandId,
            idempotencyKey: disableKey,
            origin: "HUMAN_UI",
          },
          payload: {
            moduleCode: "CORE",
          },
        },
        adminToken
      );

      expect(disableResp.statusCode).toBe(400);
      const errorBody = JSON.parse(disableResp.body);
      expect(errorBody.error.code).toBe("VALIDATION_FAILED");
    });

    it("should reject enable-module with CORE moduleCode", async () => {
      const enableCommandId = randomUUID();
      const enableKey = `idem-${randomUUID()}`;

      const enableResp = await postCommand(
        {
          name: "enable-module",
          version: 1,
          envelope: {
            commandId: enableCommandId,
            idempotencyKey: enableKey,
            origin: "HUMAN_UI",
          },
          payload: {
            moduleCode: "CORE",
          },
        },
        adminToken
      );

      expect(enableResp.statusCode).toBe(400);
      const errorBody = JSON.parse(enableResp.body);
      expect(errorBody.error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("Tenant isolation", () => {
    it("should not affect other workspace when disabling module", async () => {
      // Seed workspace B with ADMIN member and session
      const adminMemberB = await seedMember(db, {
        workspaceId: workspaceBId,
        role: "ADMIN",
        allBranches: true,
      });
      const adminSessionB = await createSession(db, {
        principalId: adminMemberB.principal.id,
        workspaceId: workspaceBId,
      });

      // RegisterAsset in workspace B should succeed
      const assetBId = randomUUID();
      const registerBCommandId = randomUUID();
      const registerBKey = `idem-${randomUUID()}`;

      const registerBResp = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: registerBCommandId,
            idempotencyKey: registerBKey,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId: assetBId,
            assetCode: "TRUCK-B-001",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
        adminSessionB.token
      );

      expect(registerBResp.statusCode).toBe(200);

      // Disable ASSETS in workspace A (using adminToken)
      const disableCommandId = randomUUID();
      const disableKey = `idem-${randomUUID()}`;

      await postCommand(
        {
          name: "disable-module",
          version: 1,
          envelope: {
            commandId: disableCommandId,
            idempotencyKey: disableKey,
            origin: "HUMAN_UI",
          },
          payload: {
            moduleCode: "ASSETS",
          },
        },
        adminToken
      );

      // RegisterAsset in workspace B should still succeed
      const assetB2Id = randomUUID();
      const registerB2CommandId = randomUUID();
      const registerB2Key = `idem-${randomUUID()}`;

      const registerB2Resp = await postCommand(
        {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: registerB2CommandId,
            idempotencyKey: registerB2Key,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId: assetB2Id,
            assetCode: "TRUCK-B-002",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
        adminSessionB.token
      );

      expect(registerB2Resp.statusCode).toBe(200);

      // Verify workspace B has no workspace_modules row for ASSETS
      const [moduleBRow] = await db
        .select()
        .from(workspaceModules)
        .where(
          and(
            eq(workspaceModules.workspaceId, workspaceBId),
            eq(workspaceModules.moduleCode, "ASSETS")
          )
        );
      expect(moduleBRow).toBeUndefined();
    });
  });
});
