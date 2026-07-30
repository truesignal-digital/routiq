import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { auditEvents, categories } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import "../server.js";

/**
 * Roadmap item 3 (ADR-0004): the tenant vocabulary is runtime data edited through
 * audited commands. Never deleted — retired and, because the (workspace, kind,
 * code) index would otherwise make a typo permanent, restorable.
 */
describe("category commands", () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let adminToken: string;
  let opsToken: string;

  beforeAll(async () => {
    testApp = await createTestApp();
    db = testApp.db;

    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;

    const admin = await seedMember(db, { workspaceId, role: "ADMIN", allBranches: true });
    adminToken = (await createSession(db, { principalId: admin.principal.id, workspaceId }))
      .token;

    const ops = await seedMember(db, { workspaceId, role: "OPS_MANAGER", allBranches: true });
    opsToken = (await createSession(db, { principalId: ops.principal.id, workspaceId })).token;
  });

  afterAll(async () => {
    await testApp.close();
  });

  function post(
    name: string,
    payload: object,
    opts: { token?: string; commandId?: string; expectedVersion?: number } = {},
  ) {
    return testApp.app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${opts.token ?? adminToken}` },
      payload: {
        version: 1,
        envelope: {
          commandId: opts.commandId ?? randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
          ...(opts.expectedVersion === undefined
            ? {}
            : { expectedVersion: opts.expectedVersion }),
        },
        payload,
      },
    });
  }

  function activeCodes(kind: string, token = adminToken) {
    return testApp.app
      .inject({
        method: "GET",
        url: `/v1/categories?kind=${kind}`,
        headers: { authorization: `Bearer ${token}` },
      })
      .then((response) => {
        expect(response.statusCode).toBe(200);
        return (response.json().categories as Array<{ code: string }>).map((row) => row.code);
      });
  }

  function createExpense(code: string, commandId?: string) {
    const id = randomUUID();
    return post(
      "create-category",
      {
        id,
        kind: "EXPENSE_CATEGORY",
        code,
        labelFr: "Péage plage",
        labelEn: "Beach toll",
        profitabilityLayer: "DIRECT",
        evidencePolicy: "NO_RECEIPT_EXPECTED",
      },
      commandId === undefined ? {} : { commandId },
    ).then((response) => ({ id, response }));
  }

  describe("create-category", () => {
    it("adds a category the pickers immediately offer, stamped and audited", async () => {
      const commandId = randomUUID();
      const { id, response } = await createExpense("PEAGE_PLAGE", commandId);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ recordId: id, rowVersion: 1 });

      const [row] = await db.select().from(categories).where(eq(categories.id, id));
      expect(row).toMatchObject({
        workspaceId,
        kind: "EXPENSE_CATEGORY",
        code: "PEAGE_PLAGE",
        labelFr: "Péage plage",
        profitabilityLayer: "DIRECT",
        evidencePolicy: "NO_RECEIPT_EXPECTED",
        active: true,
        createdByCommandId: commandId,
        rowVersion: 1,
      });

      expect(await activeCodes("EXPENSE_CATEGORY")).toContain("PEAGE_PLAGE");

      const [audit] = await db
        .select()
        .from(auditEvents)
        .where(
          and(eq(auditEvents.commandId, commandId), eq(auditEvents.eventType, "category.created")),
        );
      expect(audit?.entityType).toBe("category");
      expect(audit?.entityId).toBe(id);
      expect(audit?.beforeState).toBeNull();
      expect(audit?.afterState).toMatchObject({ code: "PEAGE_PLAGE", active: true });
    });

    it("refuses a code the workspace already uses for that kind", async () => {
      const first = await createExpense("COMMISSION_AGENCE");
      expect(first.response.statusCode).toBe(200);

      const second = await createExpense("COMMISSION_AGENCE");
      expect(second.response.statusCode).toBe(409);
      expect(second.response.json().error.code).toBe("DUPLICATE_CATEGORY_CODE");

      const rows = await db
        .select()
        .from(categories)
        .where(
          and(eq(categories.workspaceId, workspaceId), eq(categories.code, "COMMISSION_AGENCE")),
        );
      expect(rows).toHaveLength(1);
    });

    it("accepts the same code under a different kind", async () => {
      const response = await post("create-category", {
        id: randomUUID(),
        kind: "DOCUMENT_TYPE",
        code: "COMMISSION_AGENCE",
        labelFr: "Commission agence",
        labelEn: "Agency commission",
      });
      expect(response.statusCode).toBe(200);
    });

    it("holds financial categories to a profitability layer, and other kinds to none", async () => {
      const noLayer = await post("create-category", {
        id: randomUUID(),
        kind: "EXPENSE_CATEGORY",
        code: "SANS_AXE",
        labelFr: "Sans axe",
        labelEn: "No layer",
      });
      expect(noLayer.statusCode).toBe(422);
      expect(noLayer.json().error.code).toBe("CATEGORY_LAYER_INVALID");

      const strayLayer = await post("create-category", {
        id: randomUUID(),
        kind: "DOCUMENT_TYPE",
        code: "AXE_EN_TROP",
        labelFr: "Axe en trop",
        labelEn: "Stray layer",
        profitabilityLayer: "DIRECT",
      });
      expect(strayLayer.statusCode).toBe(422);
      expect(strayLayer.json().error.code).toBe("CATEGORY_LAYER_INVALID");
    });

    it("is ADMIN-only", async () => {
      const response = await post(
        "create-category",
        {
          id: randomUUID(),
          kind: "DOCUMENT_TYPE",
          code: "VISITE_TECHNIQUE",
          labelFr: "Visite technique",
          labelEn: "Technical inspection",
        },
        { token: opsToken },
      );
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("ROLE_FORBIDDEN");
    });
  });

  describe("relabel-category", () => {
    it("fixes the labels, bumps the version and audits both sides", async () => {
      const { id } = await createExpense("PEAGE_NORD");
      const commandId = randomUUID();

      const response = await post(
        "relabel-category",
        { categoryId: id, labelFr: "Péage nord", labelEn: "North toll" },
        { commandId, expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ recordId: id, rowVersion: 2 });

      const [row] = await db.select().from(categories).where(eq(categories.id, id));
      expect(row).toMatchObject({
        labelFr: "Péage nord",
        labelEn: "North toll",
        code: "PEAGE_NORD",
        rowVersion: 2,
      });

      const [audit] = await db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.commandId, commandId),
            eq(auditEvents.eventType, "category.relabeled"),
          ),
        );
      expect(audit?.beforeState).toMatchObject({ labelEn: "Beach toll", rowVersion: 1 });
      expect(audit?.afterState).toMatchObject({ labelEn: "North toll", rowVersion: 2 });
      expect(audit?.changedFields).toEqual(["labelFr", "labelEn", "rowVersion"]);
    });

    it("requires expectedVersion and refuses a stale one", async () => {
      const { id } = await createExpense("PEAGE_SUD");

      const missing = await post("relabel-category", {
        categoryId: id,
        labelFr: "Péage sud",
        labelEn: "South toll",
      });
      expect(missing.statusCode).toBe(400);
      expect(missing.json().error.code).toBe("EXPECTED_VERSION_REQUIRED");

      const stale = await post(
        "relabel-category",
        { categoryId: id, labelFr: "Péage sud", labelEn: "South toll" },
        { expectedVersion: 7 },
      );
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe("VERSION_CONFLICT");

      const [row] = await db.select().from(categories).where(eq(categories.id, id));
      expect(row?.labelEn).toBe("Beach toll");
    });

    it("reports an unknown category as a missing reference", async () => {
      const response = await post(
        "relabel-category",
        { categoryId: randomUUID(), labelFr: "Inconnu", labelEn: "Unknown" },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("REFERENCE_NOT_FOUND");
      expect(response.json().error.metadata.referenceType).toBe("category");
    });
  });

  describe("deactivate-category / reactivate-category", () => {
    it("retires a category from the pickers and restores it, refusing both no-ops", async () => {
      const { id } = await createExpense("PEAGE_EST");
      expect(await activeCodes("EXPENSE_CATEGORY")).toContain("PEAGE_EST");

      const deactivateCommandId = randomUUID();
      const deactivated = await post(
        "deactivate-category",
        { categoryId: id },
        { commandId: deactivateCommandId },
      );
      expect(deactivated.statusCode).toBe(200);
      expect(deactivated.json().rowVersion).toBe(2);
      expect(await activeCodes("EXPENSE_CATEGORY")).not.toContain("PEAGE_EST");

      const [deactivateAudit] = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.commandId, deactivateCommandId));
      expect(deactivateAudit?.eventType).toBe("category.deactivated");
      expect(deactivateAudit?.beforeState).toMatchObject({ active: true, rowVersion: 1 });
      expect(deactivateAudit?.afterState).toMatchObject({ active: false, rowVersion: 2 });

      const again = await post("deactivate-category", { categoryId: id });
      expect(again.statusCode).toBe(409);
      expect(again.json().error.code).toBe("CATEGORY_ALREADY_INACTIVE");

      const reactivated = await post("reactivate-category", { categoryId: id });
      expect(reactivated.statusCode).toBe(200);
      expect(reactivated.json().rowVersion).toBe(3);
      expect(await activeCodes("EXPENSE_CATEGORY")).toContain("PEAGE_EST");

      const alreadyActive = await post("reactivate-category", { categoryId: id });
      expect(alreadyActive.statusCode).toBe(409);
      expect(alreadyActive.json().error.code).toBe("CATEGORY_ALREADY_ACTIVE");

      const [row] = await db.select().from(categories).where(eq(categories.id, id));
      expect(row).toMatchObject({ active: true, rowVersion: 3 });
    });

    it("honors expectedVersion when the client sends one", async () => {
      const { id } = await createExpense("PEAGE_OUEST");

      const stale = await post(
        "deactivate-category",
        { categoryId: id },
        { expectedVersion: 5 },
      );
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe("VERSION_CONFLICT");

      const fresh = await post(
        "deactivate-category",
        { categoryId: id },
        { expectedVersion: 1 },
      );
      expect(fresh.statusCode).toBe(200);
    });
  });
});
