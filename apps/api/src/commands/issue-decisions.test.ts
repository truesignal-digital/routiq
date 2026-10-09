import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { auditEvents, branches, operationalIssues } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";
import { setModule } from "../test/vendor.js";

/**
 * The signalement's own state machine (#28): OPEN → RESOLVED | DISMISSED, once.
 * No triage state, no reopening. Resolution is open to whoever could report;
 * dismissal — a judgement against a report — is not open to the field.
 */
describe("issue decision commands", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let adminToken: string;
  let driverToken: string;
  let mechanicToken: string;
  let approverToken: string;
  let yaoundeMechanicToken: string;
  let assetId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;
    const [yaounde] = await db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();

    const token = async (
      role: "DIRECTOR" | "DRIVER" | "TECHNICIAN" | "FINANCE",
      scope: { allBranches: true } | { branchIds: string[] },
    ) => {
      const member = await seedMember(db, { workspaceId, role, ...scope });
      return (await createSession(db, { workspaceId, principalId: member.principal.id }))
        .token;
    };
    adminToken = await token("DIRECTOR", { allBranches: true });
    driverToken = await token("DRIVER", { branchIds: [seeded.branch.id] });
    mechanicToken = await token("TECHNICIAN", { allBranches: true });
    approverToken = await token("FINANCE", { allBranches: true });
    yaoundeMechanicToken = await token("TECHNICIAN", { branchIds: [yaounde!.id] });
    assetId = await seedAsset(ctx.app, adminToken);
  });

  afterAll(async () => {
    await ctx.close();
  });

  function post(
    token: string,
    name: string,
    payload: Record<string, unknown>,
    envelope: Record<string, unknown> = {},
  ) {
    return ctx.app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name,
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
          ...envelope,
        },
        payload,
      },
    });
  }

  async function reportIssue(token = driverToken): Promise<string> {
    const issueId = randomUUID();
    const response = await post(token, "report-issue", {
      issueId,
      assetId,
      description: "Rétroviseur cassé",
      safetyCritical: false,
    });
    expect(response.statusCode).toBe(200);
    return issueId;
  }

  function readIssue(issueId: string) {
    return db.select().from(operationalIssues).where(eq(operationalIssues.id, issueId));
  }

  it("records a new signalement as OPEN", async () => {
    const issueId = await reportIssue();
    expect((await readIssue(issueId))[0]).toMatchObject({
      status: "OPEN",
      resolvedAt: null,
      dismissedAt: null,
      rowVersion: 1,
    });
  });

  describe("resolve-issue.v1", () => {
    it("refuses the driver, who reports a fault but no longer closes one (ADR-0009)", async () => {
      const issueId = await reportIssue();
      const response = await post(
        driverToken,
        "resolve-issue",
        { issueId, note: "Rétroviseur resserré" },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });
      expect((await readIssue(issueId))[0]).toMatchObject({ status: "OPEN" });
    });

    it("lets the workshop close one fixed on the spot, with a note", async () => {
      const issueId = await reportIssue();
      const response = await post(
        mechanicToken,
        "resolve-issue",
        { issueId, note: "Rétroviseur resserré" },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        recordId: issueId,
        rowVersion: 2,
        recordStatus: "RESOLVED",
      });
      const [issue] = await readIssue(issueId);
      expect(issue).toMatchObject({
        status: "RESOLVED",
        resolutionNote: "Rétroviseur resserré",
        rowVersion: 2,
      });
      expect(issue?.resolvedAt).toBeInstanceOf(Date);

      const [event] = await db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.entityId, issueId),
            eq(auditEvents.eventType, "operational_issue.resolved"),
          ),
        );
      expect(event).toMatchObject({ entityType: "operational_issue" });
      expect(event?.afterState).toMatchObject({ resolvedByWorkOrderId: null });
    });

    it("is terminal — neither a second resolution nor a dismissal reopens it", async () => {
      const issueId = await reportIssue();
      await post(mechanicToken, "resolve-issue", { issueId }, { expectedVersion: 1 });

      const again = await post(mechanicToken, "resolve-issue", { issueId }, { expectedVersion: 2 });
      expect(again.statusCode).toBe(409);
      expect(again.json()).toMatchObject({
        error: {
          code: "INVALID_STATE_TRANSITION",
          metadata: { from: "RESOLVED", to: "RESOLVED" },
        },
      });

      const dismissed = await post(
        mechanicToken,
        "dismiss-issue",
        { issueId, reason: "Trop tard" },
        { expectedVersion: 2 },
      );
      expect(dismissed.statusCode).toBe(409);
      expect(dismissed.json()).toMatchObject({
        error: {
          code: "INVALID_STATE_TRANSITION",
          metadata: { from: "RESOLVED", to: "DISMISSED" },
        },
      });
    });

    it("requires the issue's version and rejects a stale one", async () => {
      const issueId = await reportIssue();
      const missing = await post(mechanicToken, "resolve-issue", { issueId });
      expect(missing.statusCode).toBe(400);
      expect(missing.json()).toMatchObject({ error: { code: "EXPECTED_VERSION_REQUIRED" } });

      const stale = await post(mechanicToken, "resolve-issue", { issueId }, { expectedVersion: 5 });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({
        error: { code: "VERSION_CONFLICT", metadata: { currentVersion: 1 } },
      });
    });

    it("keeps a member outside the asset's branch out", async () => {
      const issueId = await reportIssue();
      const response = await post(
        yaoundeMechanicToken,
        "resolve-issue",
        { issueId },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });
      expect((await readIssue(issueId))[0]).toMatchObject({ status: "OPEN" });
    });

    it("is not a finance decision", async () => {
      const issueId = await reportIssue();
      const response = await post(
        approverToken,
        "resolve-issue",
        { issueId },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });
    });

    it("refuses an unknown issue", async () => {
      const response = await post(
        mechanicToken,
        "resolve-issue",
        { issueId: randomUUID() },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: { code: "REFERENCE_NOT_FOUND", metadata: { referenceType: "operationalIssue" } },
      });
    });
  });

  describe("dismiss-issue.v1", () => {
    it("closes a report made in error, keeping why", async () => {
      const issueId = await reportIssue();
      const response = await post(
        mechanicToken,
        "dismiss-issue",
        { issueId, reason: "Aucun défaut constaté" },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ recordStatus: "DISMISSED", rowVersion: 2 });
      const [issue] = await readIssue(issueId);
      expect(issue).toMatchObject({
        status: "DISMISSED",
        dismissReason: "Aucun défaut constaté",
        resolvedAt: null,
      });
      expect(issue?.dismissedAt).toBeInstanceOf(Date);
    });

    it("is not the reporter's call to overrule a report", async () => {
      const issueId = await reportIssue();
      const response = await post(
        driverToken,
        "dismiss-issue",
        { issueId, reason: "Je me suis trompé" },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });
    });

    it("requires a reason", async () => {
      const issueId = await reportIssue();
      const response = await post(mechanicToken, "dismiss-issue", { issueId }, { expectedVersion: 1 });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    });

    it("takes blanks for no reason at all", async () => {
      const issueId = await reportIssue();
      const response = await post(
        mechanicToken,
        "dismiss-issue",
        { issueId, reason: "  \n " },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: "VALIDATION_FAILED", metadata: { issues: [{ path: ["reason"] }] } },
      });
    });

    it("never touches availability — a dismissed grounding stays grounded", async () => {
      const issueId = randomUUID();
      expect(
        (
          await post(driverToken, "report-issue", {
            issueId,
            assetId: await seedAsset(ctx.app, adminToken),
            description: "Freins qui lâchent",
            safetyCritical: true,
          })
        ).statusCode,
      ).toBe(200);
      await post(mechanicToken, "dismiss-issue", { issueId, reason: "Fausse alerte" }, {
        expectedVersion: 1,
      });

      const issues = await ctx.app.inject({
        method: "GET",
        url: `/v1/issues?status=DISMISSED`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const item = (issues.json() as { items: Array<{ id: string; assetUnavailable: boolean }> })
        .items.find((row) => row.id === issueId);
      expect(item).toMatchObject({ assetUnavailable: true });
    });
  });

  it("answers MODULE_DISABLED for both decisions once maintenance is off", async () => {
    const issueId = await reportIssue();
    await setModule(db, workspaceId, "MAINTENANCE", false);
    try {
      for (const [name, payload] of [
        ["resolve-issue", { issueId }],
        ["dismiss-issue", { issueId, reason: "Module coupé" }],
      ] as const) {
        const response = await post(adminToken, name, payload, { expectedVersion: 1 });
        expect(response.statusCode, name).toBe(403);
        expect(response.json(), name).toMatchObject({ error: { code: "MODULE_DISABLED" } });
      }
    } finally {
      await setModule(db, workspaceId, "MAINTENANCE", true);
    }
  });
});
