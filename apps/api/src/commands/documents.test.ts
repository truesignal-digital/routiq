import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createTestApp } from "../test/fixture.js";
import { seedWorkspace, seedMember } from "../test/seed.js";
import { createSession } from "../auth/local.js";
import { assets, auditEvents, documents } from "../db/schema.js";
import type { Db } from "../db/client.js";

describe("Documents Command", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let app: Awaited<ReturnType<typeof createTestApp>>["app"];
  let db: Db;
  let workspace: Awaited<ReturnType<typeof seedWorkspace>>["workspace"];
  let branch: Awaited<ReturnType<typeof seedWorkspace>>["branch"];
  let adminPrincipal: Awaited<ReturnType<typeof seedMember>>["principal"];
  let adminToken: string;
  let fieldSubmitterPrincipal: Awaited<ReturnType<typeof seedMember>>["principal"];
  let fieldSubmitterToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    db = ctx.db;

    const seeded = await seedWorkspace(db);
    workspace = seeded.workspace;
    branch = seeded.branch;

    const adminMember = await seedMember(db, {
      workspaceId: workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    adminPrincipal = adminMember.principal;

    const adminSession = await createSession(db, {
      principalId: adminPrincipal.id,
      workspaceId: workspace.id,
    });
    adminToken = adminSession.token;

    const fieldSubmitterMember = await seedMember(db, {
      workspaceId: workspace.id,
      role: "DRIVER",
      allBranches: true,
    });
    fieldSubmitterPrincipal = fieldSubmitterMember.principal;

    const fieldSubmitterSession = await createSession(db, {
      principalId: fieldSubmitterPrincipal.id,
      workspaceId: workspace.id,
    });
    fieldSubmitterToken = fieldSubmitterSession.token;
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

  const registerAsset = async (token: string) => {
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
          assetCode: `TRUCK-${randomUUID().slice(0, 8)}`,
          assetClassCode: "TRUCK",
          templateCode: "TRUCKING",
          branchCode: "DLA",
        },
      },
      token
    );

    if (response.statusCode !== 200) {
      throw new Error(`Failed to register asset: ${response.body}`);
    }

    return assetId;
  };

  describe("Happy path", () => {
    it("test 1: Add INSURANCE document with expiresAt returns 200", async () => {
      const assetId = await registerAsset(adminToken);
      const documentId = randomUUID();
      const commandId = randomUUID();
      const idempotencyKey = `idem-${randomUUID()}`;
      const expiresAt = "2025-12-31";

      const response = await postCommand(
        {
          name: "add-or-renew-document",
          version: 1,
          envelope: {
            commandId,
            idempotencyKey,
            origin: "HUMAN_UI",
          },
          payload: {
            documentId,
            assetId,
            documentTypeCode: "INSURANCE",
            title: "Test Insurance",
            expiresAt,
          },
        },
        adminToken
      );

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.commandId).toBe(commandId);
      expect(body.recordId).toBe(documentId);
      expect(body.rowVersion).toBe(1);

      // Verify row exists
      const rows = await db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.workspaceId, workspace.id),
            eq(documents.id, documentId)
          )
        );

      expect(rows.length).toBe(1);
      const row = rows[0]!;
      expect(row.assetId).toBe(assetId);
      expect(row.documentTypeCode).toBe("INSURANCE");
      expect(row.title).toBe("Test Insurance");
      expect(row.expiresAt).toBe(expiresAt);
      expect(row.createdByCommandId).toBe(commandId);

      // Verify audit event
      const auditEventRows = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, documentId))
        .orderBy((e) => e.occurredAt);

      expect(auditEventRows.length).toBeGreaterThan(0);
      const auditEvent = auditEventRows[0]!;
      expect(auditEvent.eventType).toBe("document.added");
      expect(auditEvent.entityType).toBe("document");
    });

    it("test 2: Renew document (new documentId, supersedesDocumentId=original) returns 200", async () => {
      const assetId = await registerAsset(adminToken);
      const originalDocumentId = randomUUID();
      const commandId1 = randomUUID();
      const idempotencyKey1 = `idem-${randomUUID()}`;

      // Add original document
      const addResponse = await postCommand(
        {
          name: "add-or-renew-document",
          version: 1,
          envelope: {
            commandId: commandId1,
            idempotencyKey: idempotencyKey1,
            origin: "HUMAN_UI",
          },
          payload: {
            documentId: originalDocumentId,
            assetId,
            documentTypeCode: "PERMIT",
            title: "Original Permit",
          },
        },
        adminToken
      );

      expect(addResponse.statusCode).toBe(200);

      // Get original row before renewal
      const originalRowsBefore = await db
        .select()
        .from(documents)
        .where(eq(documents.id, originalDocumentId));

      expect(originalRowsBefore.length).toBe(1);
      const originalRowBefore = originalRowsBefore[0]!;

      // Renew the document
      const renewedDocumentId = randomUUID();
      const commandId2 = randomUUID();
      const idempotencyKey2 = `idem-${randomUUID()}`;

      const renewResponse = await postCommand(
        {
          name: "add-or-renew-document",
          version: 1,
          envelope: {
            commandId: commandId2,
            idempotencyKey: idempotencyKey2,
            origin: "HUMAN_UI",
          },
          payload: {
            documentId: renewedDocumentId,
            assetId,
            documentTypeCode: "PERMIT",
            title: "Renewed Permit",
            supersedesDocumentId: originalDocumentId,
          },
        },
        adminToken
      );

      expect(renewResponse.statusCode).toBe(200);
      const renewBody = JSON.parse(renewResponse.body);
      expect(renewBody.recordId).toBe(renewedDocumentId);

      // Verify original row is still byte-identical
      const originalRowsAfter = await db
        .select()
        .from(documents)
        .where(eq(documents.id, originalDocumentId));

      expect(originalRowsAfter.length).toBe(1);
      const originalRowAfter = originalRowsAfter[0]!;
      expect(originalRowAfter).toEqual(originalRowBefore);

      // Verify new row has supersedesDocumentId
      const renewedRows = await db
        .select()
        .from(documents)
        .where(eq(documents.id, renewedDocumentId));

      expect(renewedRows.length).toBe(1);
      const renewedRow = renewedRows[0]!;
      expect(renewedRow.supersedesDocumentId).toBe(originalDocumentId);

      // Verify audit event is "document.renewed"
      const auditEventRows = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, renewedDocumentId))
        .orderBy((e) => e.occurredAt);

      expect(auditEventRows.length).toBeGreaterThan(0);
      const auditEvent = auditEventRows[0]!;
      expect(auditEvent.eventType).toBe("document.renewed");
    });

    it("test 3: Second renewal of SAME original (fresh documentId, same supersedesDocumentId) returns 409", async () => {
      const assetId = await registerAsset(adminToken);
      const originalDocumentId = randomUUID();
      const commandId1 = randomUUID();
      const idempotencyKey1 = `idem-${randomUUID()}`;

      // Add original
      await postCommand(
        {
          name: "add-or-renew-document",
          version: 1,
          envelope: {
            commandId: commandId1,
            idempotencyKey: idempotencyKey1,
            origin: "HUMAN_UI",
          },
          payload: {
            documentId: originalDocumentId,
            assetId,
            documentTypeCode: "INSURANCE",
          },
        },
        adminToken
      );

      // First renewal
      const firstRenewalId = randomUUID();
      const commandId2 = randomUUID();
      const idempotencyKey2 = `idem-${randomUUID()}`;

      const firstRenewalResponse = await postCommand(
        {
          name: "add-or-renew-document",
          version: 1,
          envelope: {
            commandId: commandId2,
            idempotencyKey: idempotencyKey2,
            origin: "HUMAN_UI",
          },
          payload: {
            documentId: firstRenewalId,
            assetId,
            documentTypeCode: "INSURANCE",
            supersedesDocumentId: originalDocumentId,
          },
        },
        adminToken
      );

      expect(firstRenewalResponse.statusCode).toBe(200);

      // Second renewal of SAME original should fail
      const secondRenewalId = randomUUID();
      const commandId3 = randomUUID();
      const idempotencyKey3 = `idem-${randomUUID()}`;

      const secondRenewalResponse = await postCommand(
        {
          name: "add-or-renew-document",
          version: 1,
          envelope: {
            commandId: commandId3,
            idempotencyKey: idempotencyKey3,
            origin: "HUMAN_UI",
          },
          payload: {
            documentId: secondRenewalId,
            assetId,
            documentTypeCode: "INSURANCE",
            supersedesDocumentId: originalDocumentId,
          },
        },
        adminToken
      );

      expect(secondRenewalResponse.statusCode).toBe(409);
      const body = JSON.parse(secondRenewalResponse.body);
      expect(body.error.code).toBe("DOCUMENT_ALREADY_SUPERSEDED");
    });

    it("test 4: Renewal referencing document of DIFFERENT asset returns 422", async () => {
      const assetId1 = await registerAsset(adminToken);
      const assetId2 = await registerAsset(adminToken);

      const docInAsset1 = randomUUID();
      const commandId1 = randomUUID();
      const idempotencyKey1 = `idem-${randomUUID()}`;

      // Add document to asset 1
      await postCommand(
        {
          name: "add-or-renew-document",
          version: 1,
          envelope: {
            commandId: commandId1,
            idempotencyKey: idempotencyKey1,
            origin: "HUMAN_UI",
          },
          payload: {
            documentId: docInAsset1,
            assetId: assetId1,
            documentTypeCode: "PERMIT",
          },
        },
        adminToken
      );

      // Try to renew it in asset 2
      const renewalId = randomUUID();
      const commandId2 = randomUUID();
      const idempotencyKey2 = `idem-${randomUUID()}`;

      const response = await postCommand(
        {
          name: "add-or-renew-document",
          version: 1,
          envelope: {
            commandId: commandId2,
            idempotencyKey: idempotencyKey2,
            origin: "HUMAN_UI",
          },
          payload: {
            documentId: renewalId,
            assetId: assetId2,
            documentTypeCode: "PERMIT",
            supersedesDocumentId: docInAsset1,
          },
        },
        adminToken
      );

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("REFERENCE_NOT_FOUND");
    });

    it("test 5: Unknown documentTypeCode (VISA) returns 422", async () => {
      const assetId = await registerAsset(adminToken);
      const documentId = randomUUID();
      const commandId = randomUUID();
      const idempotencyKey = `idem-${randomUUID()}`;

      const response = await postCommand(
        {
          name: "add-or-renew-document",
          version: 1,
          envelope: {
            commandId,
            idempotencyKey,
            origin: "HUMAN_UI",
          },
          payload: {
            documentId,
            assetId,
            documentTypeCode: "VISA",
          },
        },
        adminToken
      );

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("REFERENCE_NOT_FOUND");
    });

    it("test 6: Disposed-asset invariant (RETIRED asset) returns 409 ASSET_NOT_OPERATIONAL", async () => {
      const assetId = await registerAsset(adminToken);

      // Manually set asset to RETIRED
      await db
        .update(assets)
        .set({ lifecycleStatus: "RETIRED" })
        .where(eq(assets.id, assetId));

      const documentId = randomUUID();
      const commandId = randomUUID();
      const idempotencyKey = `idem-${randomUUID()}`;

      const response = await postCommand(
        {
          name: "add-or-renew-document",
          version: 1,
          envelope: {
            commandId,
            idempotencyKey,
            origin: "HUMAN_UI",
          },
          payload: {
            documentId,
            assetId,
            documentTypeCode: "INSURANCE",
          },
        },
        adminToken
      );

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("ASSET_NOT_OPERATIONAL");
      expect(body.error.metadata.lifecycleStatus).toBe("RETIRED");

      // Verify no document row was created
      const rows = await db
        .select()
        .from(documents)
        .where(eq(documents.id, documentId));

      expect(rows.length).toBe(0);
    });

    it("test 7: No-edit-path proof: command registry contains add-or-renew-document.v1", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/commands",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const commands = body.commands;

      expect(commands).toContain("add-or-renew-document.v1");
      expect(commands.some((c: string) => c.includes("update-document"))).toBe(false);
      expect(commands.some((c: string) => c.includes("edit-document"))).toBe(false);
    });

    it("test 8: DRIVER member cannot add a document (ADR-0009)", async () => {
      const assetId = await registerAsset(adminToken);
      const documentId = randomUUID();
      const commandId = randomUUID();
      const idempotencyKey = `idem-${randomUUID()}`;

      const response = await postCommand(
        {
          name: "add-or-renew-document",
          version: 1,
          envelope: {
            commandId,
            idempotencyKey,
            origin: "HUMAN_UI",
          },
          payload: {
            documentId,
            assetId,
            documentTypeCode: "INSURANCE",
            title: "Field Submitted Document",
          },
        },
        fieldSubmitterToken
      );

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error.code).toBe("ROLE_FORBIDDEN");

      const rows = await db
        .select()
        .from(documents)
        .where(eq(documents.id, documentId));
      expect(rows).toHaveLength(0);
    });
  });
});
