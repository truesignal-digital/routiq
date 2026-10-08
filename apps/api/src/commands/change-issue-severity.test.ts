import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import {
  assetAvailabilityIntervals,
  auditEvents,
  branches,
  operationalIssues,
} from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

/**
 * change-issue-severity.v1 (#96): the reporter who forgot the box marks the
 * problem safety-critical afterwards, and the vehicle is grounded as if it had
 * been reported so. Only the managers take the mark off, and that never puts
 * the vehicle back on the road.
 */
describe("change-issue-severity.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let directorToken: string;
  let adminToken: string;
  let driverToken: string;
  let otherDriverToken: string;
  let technicianToken: string;
  let financeToken: string;
  let yaoundeDriverToken: string;

  type SeedRole = "DIRECTOR" | "ADMIN" | "DRIVER" | "TECHNICIAN" | "FINANCE";

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
      role: SeedRole,
      scope: { allBranches: true } | { branchIds: string[] } = { branchIds: [seeded.branch.id] },
    ) => {
      const member = await seedMember(db, { workspaceId, role, ...scope });
      return (await createSession(db, { workspaceId, principalId: member.principal.id })).token;
    };
    directorToken = await token("DIRECTOR", { allBranches: true });
    adminToken = await token("ADMIN");
    driverToken = await token("DRIVER");
    otherDriverToken = await token("DRIVER");
    technicianToken = await token("TECHNICIAN");
    financeToken = await token("FINANCE", { allBranches: true });
    yaoundeDriverToken = await token("DRIVER", { branchIds: [yaounde!.id] });
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

  const change = (
    token: string,
    issueId: string,
    payload: { safetyCritical: boolean; reason?: string },
    expectedVersion: number | null = 1,
  ) =>
    post(
      token,
      "change-issue-severity",
      { issueId, ...payload },
      expectedVersion === null ? {} : { expectedVersion },
    );

  /** A fresh vehicle with one problem reported by the driver, not safety-critical. */
  async function reported(safetyCritical = false): Promise<{ assetId: string; issueId: string }> {
    const assetId = await seedAsset(ctx.app, directorToken);
    const issueId = randomUUID();
    const response = await post(driverToken, "report-issue", {
      issueId,
      assetId,
      description: "Freins qui grincent",
      safetyCritical,
    });
    expect(response.statusCode).toBe(200);
    return { assetId, issueId };
  }

  const openGroundings = (assetId: string) =>
    db
      .select()
      .from(assetAvailabilityIntervals)
      .where(
        and(
          eq(assetAvailabilityIntervals.assetId, assetId),
          isNull(assetAvailabilityIntervals.closedAt),
        ),
      );

  const issueRow = async (issueId: string) =>
    (await db.select().from(operationalIssues).where(eq(operationalIssues.id, issueId)))[0];

  const issueEvents = (issueId: string) =>
    db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, issueId))
      .orderBy(asc(auditEvents.occurredAt), asc(auditEvents.id));

  describe("raising", () => {
    it("lets the reporter mark it safety-critical, and grounds the vehicle like a critical report", async () => {
      const { assetId, issueId } = await reported();
      expect(await openGroundings(assetId)).toHaveLength(0);

      const response = await change(driverToken, issueId, { safetyCritical: true });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ recordId: issueId, rowVersion: 2 });

      expect(await issueRow(issueId)).toMatchObject({ safetyCritical: true, rowVersion: 2, status: "OPEN" });
      const grounded = await openGroundings(assetId);
      expect(grounded).toHaveLength(1);
      expect(grounded[0]).toMatchObject({ openedByIssueId: issueId });

      const detail = await ctx.app.inject({
        method: "GET",
        url: `/v1/assets/${assetId}`,
        headers: { authorization: `Bearer ${directorToken}` },
      });
      expect(detail.json().availability).toMatchObject({
        state: "GROUNDED",
        issue: { id: issueId, safetyCritical: true },
      });
    });

    it("keeps the original severity and records who changed it, from what and to what", async () => {
      const { issueId } = await reported();
      await change(driverToken, issueId, { safetyCritical: true });

      const events = await issueEvents(issueId);
      expect(events.map((event) => event.eventType)).toEqual([
        "operational_issue.reported",
        "operational_issue.severity_raised",
      ]);
      expect(events[0]?.afterState).toMatchObject({ safetyCritical: false });
      expect(events[1]).toMatchObject({
        beforeState: { safetyCritical: false, rowVersion: 1 },
        afterState: { safetyCritical: true, reason: null, rowVersion: 2 },
        changedFields: ["safetyCritical", "rowVersion"],
      });
    });

    it("lets any driver or technician of the branch raise it, not only the reporter", async () => {
      for (const token of [otherDriverToken, technicianToken, adminToken]) {
        const { assetId, issueId } = await reported();
        const response = await change(token, issueId, { safetyCritical: true });
        expect(response.statusCode, "raise").toBe(200);
        expect(await openGroundings(assetId)).toHaveLength(1);
      }
    });

    it("opens no second grounding on a vehicle already down", async () => {
      const { assetId } = await reported(true);
      const second = randomUUID();
      await post(driverToken, "report-issue", {
        issueId: second,
        assetId,
        description: "Rétroviseur",
        safetyCritical: false,
      });
      const response = await change(driverToken, second, { safetyCritical: true });
      expect(response.statusCode).toBe(200);
      expect(await openGroundings(assetId)).toHaveLength(1);
    });

    it("refuses a problem already marked safety-critical", async () => {
      const { issueId } = await reported(true);
      const response = await change(driverToken, issueId, { safetyCritical: true });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: "ISSUE_SEVERITY_ALREADY_SET", metadata: { safetyCritical: true } },
      });
    });

    it("refuses the roles that do not report problems", async () => {
      const { issueId } = await reported();
      const response = await change(financeToken, issueId, { safetyCritical: true });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });
      expect(await issueRow(issueId)).toMatchObject({ safetyCritical: false, rowVersion: 1 });
    });

    it("keeps a driver outside the vehicle's branch out", async () => {
      const { assetId, issueId } = await reported();
      const response = await change(yaoundeDriverToken, issueId, { safetyCritical: true });
      expect(response.statusCode).toBe(403);
      expect(await openGroundings(assetId)).toHaveLength(0);
    });
  });

  describe("lowering", () => {
    it("refuses the driver ROLE_FORBIDDEN, even the reporter", async () => {
      const { assetId, issueId } = await reported(true);
      const response = await change(driverToken, issueId, {
        safetyCritical: false,
        reason: "Ce n'était que le rétroviseur",
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: { code: "ROLE_FORBIDDEN", metadata: { change: "LOWER" } },
      });
      expect(await issueRow(issueId)).toMatchObject({ safetyCritical: true, rowVersion: 1 });
      expect(await openGroundings(assetId)).toHaveLength(1);
    });

    it("refuses the technician too", async () => {
      const { issueId } = await reported(true);
      const response = await change(technicianToken, issueId, {
        safetyCritical: false,
        reason: "Rien de grave",
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });
    });

    it("lets a manager take the mark off with a reason, and leaves the vehicle grounded", async () => {
      for (const token of [adminToken, directorToken]) {
        const { assetId, issueId } = await reported(true);
        const response = await change(token, issueId, {
          safetyCritical: false,
          reason: "Vu au garage : rétroviseur seulement",
        });
        expect(response.statusCode).toBe(200);
        expect(await issueRow(issueId)).toMatchObject({ safetyCritical: false, rowVersion: 2 });

        const grounded = await openGroundings(assetId);
        expect(grounded).toHaveLength(1);
        expect(grounded[0]).toMatchObject({ openedByIssueId: issueId, closedAt: null });

        const lowered = (await issueEvents(issueId)).at(-1);
        expect(lowered).toMatchObject({
          eventType: "operational_issue.severity_lowered",
          beforeState: { safetyCritical: true },
          afterState: { safetyCritical: false, reason: "Vu au garage : rétroviseur seulement" },
        });
      }
    });

    it("needs a reason", async () => {
      const { issueId } = await reported(true);
      const response = await change(adminToken, issueId, { safetyCritical: false });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    });
  });

  describe("on any change", () => {
    it("refuses a resolved or dismissed problem", async () => {
      const resolved = await reported();
      expect(
        (await post(technicianToken, "resolve-issue", { issueId: resolved.issueId }, { expectedVersion: 1 }))
          .statusCode,
      ).toBe(200);
      const dismissed = await reported(true);
      expect(
        (
          await post(
            adminToken,
            "dismiss-issue",
            { issueId: dismissed.issueId, reason: "Doublon" },
            { expectedVersion: 1 },
          )
        ).statusCode,
      ).toBe(200);

      const raise = await change(driverToken, resolved.issueId, { safetyCritical: true }, 2);
      expect(raise.statusCode).toBe(409);
      expect(raise.json()).toMatchObject({
        error: { code: "INVALID_STATE_TRANSITION", metadata: { from: "RESOLVED" } },
      });
      expect(await openGroundings(resolved.assetId)).toHaveLength(0);

      const lower = await change(adminToken, dismissed.issueId, { safetyCritical: false, reason: "x" }, 2);
      expect(lower.statusCode).toBe(409);
      expect(lower.json()).toMatchObject({
        error: { code: "INVALID_STATE_TRANSITION", metadata: { from: "DISMISSED" } },
      });
    });

    it("requires the problem's version and refuses a stale one", async () => {
      const { issueId } = await reported();
      const missing = await change(driverToken, issueId, { safetyCritical: true }, null);
      expect(missing.statusCode).toBe(400);
      expect(missing.json()).toMatchObject({ error: { code: "EXPECTED_VERSION_REQUIRED" } });

      const stale = await change(driverToken, issueId, { safetyCritical: true }, 4);
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({ error: { code: "VERSION_CONFLICT" } });
    });

    it("shows on the vehicle's history and the problem's chronologie", async () => {
      const { assetId, issueId } = await reported();
      await change(driverToken, issueId, { safetyCritical: true });
      await change(adminToken, issueId, { safetyCritical: false, reason: "Rétroviseur seulement" }, 2);

      const history = await ctx.app.inject({
        method: "GET",
        url: `/v1/assets/${assetId}/history?limit=100`,
        headers: { authorization: `Bearer ${directorToken}` },
      });
      expect(history.statusCode).toBe(200);
      const items = (history.json() as {
        items: Array<{ eventType: string; params: Record<string, unknown>; note: string | null }>;
      }).items;
      const byType = (type: string) => items.find((item) => item.eventType === type);
      expect(byType("operational_issue.reported")?.params).toMatchObject({ safetyCritical: false });
      expect(byType("operational_issue.severity_raised")?.params).toMatchObject({ safetyCritical: true });
      expect(byType("operational_issue.severity_lowered")).toMatchObject({
        params: { safetyCritical: false },
        note: "Rétroviseur seulement",
      });
      expect(byType("asset_availability.opened")).toBeDefined();

      const detail = await ctx.app.inject({
        method: "GET",
        url: `/v1/issues/${issueId}`,
        headers: { authorization: `Bearer ${driverToken}` },
      });
      expect((detail.json() as { chronologie: Array<{ kind: string }> }).chronologie.map((e) => e.kind)).toEqual([
        "operational_issue.reported",
        "operational_issue.severity_raised",
        "operational_issue.severity_lowered",
      ]);
    });
  });
});
