import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import {
  approvalRules,
  assetAvailabilityIntervals,
  auditEvents,
  operationalIssues,
} from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

/**
 * Remise en service: the decision that ends a grounding.
 *
 * The guard starts from what grounded the asset (#47 finding 1): the open
 * interval, its signalement, and a COMPLETED work order answering THAT
 * signalement — or, once the signalement itself was closed, an explicit
 * override reason. A second pair of eyes signs it off (§5.1), and it is never
 * an AI's call (#47 finding 2).
 */
describe("release-asset-to-service.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let adminToken: string;
  let managerToken: string;
  let mechanicToken: string;
  let otherWorkspaceWorkOrderId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;

    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;

    adminToken = await tokenFor("ADMIN");
    managerToken = await tokenFor("ADMIN");
    mechanicToken = await tokenFor("TECHNICIAN");

    const otherSeeded = await seedWorkspace(db);
    const otherAdmin = await seedMember(db, {
      workspaceId: otherSeeded.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    const otherToken = (
      await createSession(db, {
        workspaceId: otherSeeded.workspace.id,
        principalId: otherAdmin.principal.id,
      })
    ).token;
    const foreignAssetId = await seedAsset(ctx.app, otherToken);
    otherWorkspaceWorkOrderId = randomUUID();
    expect(
      (
        await post(otherToken, "create-work-order", {
          workOrderId: otherWorkspaceWorkOrderId,
          assetId: foreignAssetId,
          description: "Révision chez le voisin",
          expectedCostMinor: 0,
        })
      ).statusCode,
    ).toBe(200);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function tokenFor(
    role: "ADMIN" | "TECHNICIAN",
    principalType: "HUMAN" | "AI_AGENT" | "INTEGRATION" = "HUMAN",
  ): Promise<string> {
    const member = await seedMember(db, {
      workspaceId,
      role,
      principalType,
      allBranches: true,
    });
    return (await createSession(db, { workspaceId, principalId: member.principal.id }))
      .token;
  }

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

  function openIntervals(assetId: string) {
    return db
      .select()
      .from(assetAvailabilityIntervals)
      .where(
        and(
          eq(assetAvailabilityIntervals.assetId, assetId),
          isNull(assetAvailabilityIntervals.closedAt),
        ),
      );
  }

  function readIssue(issueId: string) {
    return db.select().from(operationalIssues).where(eq(operationalIssues.id, issueId));
  }

  async function reportIssue(
    assetId: string,
    safetyCritical: boolean,
    description = "Plaquettes de frein hors service",
  ): Promise<string> {
    const issueId = randomUUID();
    expect(
      (
        await post(managerToken, "report-issue", {
          issueId,
          assetId,
          description,
          safetyCritical,
        })
      ).statusCode,
    ).toBe(200);
    return issueId;
  }

  async function createWorkOrder(
    assetId: string,
    issueId: string | undefined,
  ): Promise<string> {
    const workOrderId = randomUUID();
    const response = await post(managerToken, "create-work-order", {
      workOrderId,
      assetId,
      ...(issueId === undefined ? {} : { issueId }),
      description: "Remplacement du système de freinage",
      expectedCostMinor: 90_000,
    });
    expect(response.json()).toMatchObject({ recordStatus: "APPROVED" });
    return workOrderId;
  }

  async function completeWorkOrder(
    workOrderId: string,
    completerToken = managerToken,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const completed = await post(
      completerToken,
      "complete-work-order",
      { workOrderId, actualCostMinor: 88_000, summary: "Freins refaits", ...extra },
      { expectedVersion: 1 },
    );
    expect(completed.json()).toMatchObject({ recordStatus: "COMPLETED" });
  }

  /**
   * The whole journey: a safety-critical signalement grounds the truck and a
   * work order answers it. `completerToken` declares the repair finished — the
   * person the release must differ from.
   */
  async function groundedAsset(
    opts: { completerToken?: string; complete?: boolean; resolveLinkedIssue?: boolean } = {},
  ): Promise<{ assetId: string; issueId: string; workOrderId: string }> {
    const assetId = await seedAsset(ctx.app, adminToken);
    const issueId = await reportIssue(assetId, true);
    const workOrderId = await createWorkOrder(assetId, issueId);
    if (opts.complete !== false) {
      await completeWorkOrder(
        workOrderId,
        opts.completerToken ?? managerToken,
        opts.resolveLinkedIssue === undefined
          ? {}
          : { resolveLinkedIssue: opts.resolveLinkedIssue },
      );
    }
    return { assetId, issueId, workOrderId };
  }

  describe("the happy path", () => {
    it("closes the grounding when someone other than the mechanic signs it off", async () => {
      const { assetId, workOrderId } = await groundedAsset();
      expect(await openIntervals(assetId)).toHaveLength(1);

      const response = await post(adminToken, "release-asset-to-service", {
        assetId,
        workOrderId,
        note: "Essai routier concluant",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        recordStatus: "AVAILABLE",
        rowVersion: 2,
      });
      expect(await openIntervals(assetId)).toHaveLength(0);

      const [interval] = await db
        .select()
        .from(assetAvailabilityIntervals)
        .where(eq(assetAvailabilityIntervals.assetId, assetId));
      expect(interval?.closedAt).toBeInstanceOf(Date);
      expect(interval?.closedByCommandId).not.toBeNull();
    });

    it("finds the completed work order itself when the release names none", async () => {
      const { assetId, workOrderId } = await groundedAsset();
      const response = await post(adminToken, "release-asset-to-service", { assetId });
      expect(response.statusCode).toBe(200);

      const [released] = await db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.entityId, workOrderId),
            eq(auditEvents.eventType, "work_order.asset_released"),
          ),
        );
      expect(released).toBeDefined();
    });

    /** #28: release and resolution are decoupled — the release never writes the issue. */
    it("never touches the signalement's status", async () => {
      const { assetId, issueId } = await groundedAsset({ resolveLinkedIssue: false });
      const [before] = await readIssue(issueId);
      expect(before).toMatchObject({ status: "OPEN" });

      expect(
        (await post(adminToken, "release-asset-to-service", { assetId })).statusCode,
      ).toBe(200);
      expect((await readIssue(issueId))[0]).toEqual(before);
    });
  });

  describe("what has to be true of the grounding", () => {
    it("refuses a release when the asset holds no grounding", async () => {
      const assetId = await seedAsset(ctx.app, adminToken);
      const response = await post(adminToken, "release-asset-to-service", { assetId });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: "ASSET_NOT_UNAVAILABLE" },
      });
    });

    it("refuses a second release of the same grounding", async () => {
      const { assetId, workOrderId } = await groundedAsset();
      expect(
        (await post(adminToken, "release-asset-to-service", { assetId, workOrderId }))
          .statusCode,
      ).toBe(200);
      const again = await post(adminToken, "release-asset-to-service", {
        assetId,
        workOrderId,
      });
      expect(again.statusCode).toBe(409);
      expect(again.json()).toMatchObject({ error: { code: "ASSET_NOT_UNAVAILABLE" } });
    });

    for (const [label, prepare] of [
      ["still APPROVED", async (_workOrderId: string) => {}],
      [
        "waiting on a completion review",
        async (workOrderId: string) => {
          // A threshold only Direction clears, so the manager's completion is held.
          const [rule] = await db
            .insert(approvalRules)
            .values({
              workspaceId,
              commandType: "complete-work-order",
              categoryCode: null,
              branchId: null,
              amountMinMinor: 10_000n,
              amountMaxMinor: null,
              requiredRole: "DIRECTOR",
              createdByCommandId: null,
            })
            .returning({ id: approvalRules.id });
          try {
            const held = await post(
              managerToken,
              "complete-work-order",
              { workOrderId, actualCostMinor: 50_000 },
              { expectedVersion: 1 },
            );
            expect(held.json()).toMatchObject({ recordStatus: "COMPLETION_SUBMITTED" });
          } finally {
            await db.delete(approvalRules).where(eq(approvalRules.id, rule!.id));
          }
        },
      ],
    ] as const) {
      it(`refuses a release on work ${label}`, async () => {
        const { assetId, workOrderId } = await groundedAsset({ complete: false });
        await prepare(workOrderId);

        const cited = await post(adminToken, "release-asset-to-service", {
          assetId,
          workOrderId,
        });
        expect(cited.statusCode).toBe(409);
        expect(cited.json()).toMatchObject({
          error: { code: "WORK_ORDER_NOT_COMPLETED", metadata: { workOrderId } },
        });

        const uncited = await post(adminToken, "release-asset-to-service", { assetId });
        expect(uncited.statusCode).toBe(409);
        expect(uncited.json()).toMatchObject({
          error: {
            code: "WORK_ORDER_NOT_COMPLETED",
            metadata: { issueStatus: "OPEN", overrideAllowed: false },
          },
        });
        expect(await openIntervals(assetId)).toHaveLength(1);
      });
    }

    it("refuses a work order that belongs to another asset", async () => {
      const { assetId } = await groundedAsset();
      const { workOrderId: foreignOrder } = await groundedAsset();
      const response = await post(adminToken, "release-asset-to-service", {
        assetId,
        workOrderId: foreignOrder,
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: { code: "WORK_ORDER_ASSET_MISMATCH" },
      });
    });

    /**
     * #47 finding 1, reproduced: an old, completed, issue-less order on the same
     * truck used to satisfy the guard while the release closed whatever
     * grounding was open. It no longer vouches for a fault it was never about.
     */
    it("refuses a completed preventive order as the grounds for a safety-critical release", async () => {
      const assetId = await seedAsset(ctx.app, adminToken);
      const preventive = await createWorkOrder(assetId, undefined);
      await completeWorkOrder(preventive);
      const issueId = await reportIssue(assetId, true);

      const response = await post(adminToken, "release-asset-to-service", {
        assetId,
        workOrderId: preventive,
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: {
          code: "WORK_ORDER_ISSUE_MISMATCH",
          metadata: { workOrderId: preventive, workOrderIssueId: null, groundingIssueId: issueId },
        },
      });
      expect(await openIntervals(assetId)).toHaveLength(1);
    });

    it("refuses completed work on a different, non-critical fault of the same truck", async () => {
      const assetId = await seedAsset(ctx.app, adminToken);
      const groundingIssue = await reportIssue(assetId, true);
      const cosmeticIssue = await reportIssue(assetId, false, "Rayure sur la portière");
      const cosmeticOrder = await createWorkOrder(assetId, cosmeticIssue);
      await completeWorkOrder(cosmeticOrder);

      const response = await post(adminToken, "release-asset-to-service", {
        assetId,
        workOrderId: cosmeticOrder,
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: {
          code: "WORK_ORDER_ISSUE_MISMATCH",
          metadata: { groundingIssueId: groundingIssue },
        },
      });

      // And uncited, the cosmetic repair does not count either.
      const uncited = await post(adminToken, "release-asset-to-service", { assetId });
      expect(uncited.statusCode).toBe(409);
      expect(uncited.json()).toMatchObject({ error: { code: "WORK_ORDER_NOT_COMPLETED" } });
      expect(await openIntervals(assetId)).toHaveLength(1);
    });

    it("cannot release against another workspace's order", async () => {
      const { assetId } = await groundedAsset();
      const response = await post(adminToken, "release-asset-to-service", {
        assetId,
        workOrderId: otherWorkspaceWorkOrderId,
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: { code: "REFERENCE_NOT_FOUND", metadata: { referenceType: "workOrder" } },
      });
    });
  });

  describe("the override path, once the signalement is closed without a work order", () => {
    it("releases a truck whose fault was resolved on the spot, with a reason", async () => {
      const assetId = await seedAsset(ctx.app, adminToken);
      const issueId = await reportIssue(assetId, true);
      expect(
        (
          await post(
            mechanicToken,
            "resolve-issue",
            { issueId, note: "Durite reclipsée" },
            { expectedVersion: 1 },
          )
        ).statusCode,
      ).toBe(200);

      const withoutReason = await post(adminToken, "release-asset-to-service", { assetId });
      expect(withoutReason.statusCode).toBe(409);
      expect(withoutReason.json()).toMatchObject({
        error: {
          code: "WORK_ORDER_NOT_COMPLETED",
          metadata: { issueStatus: "RESOLVED", overrideAllowed: true },
        },
      });

      const response = await post(adminToken, "release-asset-to-service", {
        assetId,
        overrideReason: "Réparé sur place, contrôlé au dépôt",
      });
      expect(response.statusCode).toBe(200);
      expect(await openIntervals(assetId)).toHaveLength(0);

      const [closed] = await db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.eventType, "asset_availability.closed"),
            eq(auditEvents.entityType, "asset_availability_interval"),
            eq(auditEvents.commandId, (response.json() as { commandId: string }).commandId),
          ),
        );
      expect(closed?.afterState).toMatchObject({
        overrideReason: "Réparé sur place, contrôlé au dépôt",
      });
    });

    it("releases a truck whose report was dismissed as made in error", async () => {
      const assetId = await seedAsset(ctx.app, adminToken);
      const issueId = await reportIssue(assetId, true);
      await post(mechanicToken, "dismiss-issue", { issueId, reason: "Fausse alerte" }, {
        expectedVersion: 1,
      });
      const response = await post(adminToken, "release-asset-to-service", {
        assetId,
        overrideReason: "Signalement classé sans suite",
      });
      expect(response.statusCode).toBe(200);
    });

    it("refuses an override while the signalement is still open", async () => {
      const assetId = await seedAsset(ctx.app, adminToken);
      await reportIssue(assetId, true);
      const response = await post(adminToken, "release-asset-to-service", {
        assetId,
        overrideReason: "Je prends la responsabilité",
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: "WORK_ORDER_NOT_COMPLETED", metadata: { overrideAllowed: false } },
      });
      expect(await openIntervals(assetId)).toHaveLength(1);
    });

    it("refuses the member who closed the signalement from releasing on it", async () => {
      const assetId = await seedAsset(ctx.app, adminToken);
      const issueId = await reportIssue(assetId, true);
      await post(managerToken, "resolve-issue", { issueId }, { expectedVersion: 1 });
      const response = await post(managerToken, "release-asset-to-service", {
        assetId,
        overrideReason: "Moi seul",
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: { code: "SELF_RELEASE_FORBIDDEN", metadata: { issueId } },
      });
      expect(await openIntervals(assetId)).toHaveLength(1);
    });

    it("checks the quoted version against the signalement it acts from", async () => {
      const assetId = await seedAsset(ctx.app, adminToken);
      const issueId = await reportIssue(assetId, true);
      await post(mechanicToken, "dismiss-issue", { issueId, reason: "Doublon" }, {
        expectedVersion: 1,
      });
      const stale = await post(
        adminToken,
        "release-asset-to-service",
        { assetId, overrideReason: "Doublon" },
        { expectedVersion: 1 },
      );
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({
        error: { code: "VERSION_CONFLICT", metadata: { currentVersion: 2 } },
      });
    });
  });

  /**
   * A second safety-critical report on a truck already down opens no interval
   * of its own, so the release is where it must hold the truck back (review
   * P3): repairing the brakes cannot put a truck with a jammed steering column
   * back on the road.
   */
  describe("every other safety-critical signalement closed first", () => {
    /**
     * What the asset read tells the client to lock its Release step on (#501).
     * Each case below checks it against the command's answer, so the lock and
     * the refusal cannot drift apart.
     */
    async function releaseLockedBy(assetId: string): Promise<unknown> {
      const detail = await ctx.app.inject({
        method: "GET",
        url: `/v1/assets/${assetId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const availability = detail.json().availability;
      expect(availability.state).toBe("GROUNDED");
      return availability.otherOpenSafetyIssues;
    }

    it("keeps the truck grounded until the second signalement is closed", async () => {
      const { assetId, workOrderId } = await groundedAsset();
      const steering = await reportIssue(assetId, true, "Direction bloquée");
      expect(await releaseLockedBy(assetId)).toEqual([
        { id: steering, description: "Direction bloquée" },
      ]);

      const refused = await post(adminToken, "release-asset-to-service", { assetId, workOrderId });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toEqual({
        error: { code: "SAFETY_ISSUE_OPEN", metadata: { assetId, openIssueIds: [steering] } },
      });
      expect(await openIntervals(assetId)).toHaveLength(1);
      const detail = await ctx.app.inject({
        method: "GET",
        url: `/v1/assets/${assetId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(detail.json()).toMatchObject({ availability: { state: "GROUNDED" } });

      expect(
        (await post(mechanicToken, "resolve-issue", { issueId: steering }, { expectedVersion: 1 }))
          .statusCode,
      ).toBe(200);
      expect(await releaseLockedBy(assetId)).toEqual([]);
      const released = await post(adminToken, "release-asset-to-service", { assetId, workOrderId });
      expect(released.statusCode).toBe(200);
      expect(await openIntervals(assetId)).toHaveLength(0);
    });

    it("refuses the override path the same way", async () => {
      const assetId = await seedAsset(ctx.app, adminToken);
      const brakes = await reportIssue(assetId, true);
      const steering = await reportIssue(assetId, true, "Direction bloquée");
      await post(mechanicToken, "dismiss-issue", { issueId: brakes, reason: "Fausse alerte" }, {
        expectedVersion: 1,
      });
      expect(await releaseLockedBy(assetId)).toEqual([
        { id: steering, description: "Direction bloquée" },
      ]);

      const refused = await post(adminToken, "release-asset-to-service", {
        assetId,
        overrideReason: "Signalement classé sans suite",
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({
        error: { code: "SAFETY_ISSUE_OPEN", metadata: { openIssueIds: [steering] } },
      });
      expect(await openIntervals(assetId)).toHaveLength(1);
    });

    it("lets a minor fault left open ride along", async () => {
      const { assetId, workOrderId } = await groundedAsset();
      await reportIssue(assetId, false, "Rétroviseur fissuré");
      expect(await releaseLockedBy(assetId)).toEqual([]);
      const response = await post(adminToken, "release-asset-to-service", { assetId, workOrderId });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ warnings: [] });
    });

    it("warns when the release leaves the grounding signalement itself open", async () => {
      const { assetId, workOrderId } = await groundedAsset({ resolveLinkedIssue: false });
      const response = await post(adminToken, "release-asset-to-service", { assetId, workOrderId });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ warnings: ["GROUNDING_ISSUE_STILL_OPEN"] });
    });
  });

  describe("two pairs of eyes", () => {
    it("refuses the member who declared the safety-critical work complete", async () => {
      const { assetId, workOrderId } = await groundedAsset({
        completerToken: managerToken,
      });
      for (const payload of [{ assetId, workOrderId }, { assetId }]) {
        const response = await post(managerToken, "release-asset-to-service", payload);
        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({
          error: { code: "SELF_RELEASE_FORBIDDEN" },
        });
      }
      expect(await openIntervals(assetId)).toHaveLength(1);
    });

    it("refuses a completer who cites a colleague's order on the same grounding", async () => {
      const { assetId, issueId, workOrderId: managersOrder } = await groundedAsset({
        completerToken: managerToken,
      });
      const adminsOrder = await createWorkOrder(assetId, issueId);
      await completeWorkOrder(adminsOrder, adminToken, { resolveLinkedIssue: false });

      const response = await post(managerToken, "release-asset-to-service", {
        assetId,
        workOrderId: adminsOrder,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: "SELF_RELEASE_FORBIDDEN" } });
      expect(managersOrder).not.toBe(adminsOrder);
    });
  });

  describe("who may release", () => {
    /** #47 finding 2, reproduced: an AI principal holding ADMIN used to be let through. */
    for (const principalType of ["AI_AGENT", "INTEGRATION"] as const) {
      it(`refuses an ${principalType} principal whatever its role`, async () => {
        const { assetId, workOrderId } = await groundedAsset();
        const agentToken = await tokenFor("ADMIN", principalType);
        const response = await post(agentToken, "release-asset-to-service", {
          assetId,
          workOrderId,
        });
        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({
          error: { code: "HUMAN_PRINCIPAL_REQUIRED", metadata: { principalType } },
        });
        expect(await openIntervals(assetId)).toHaveLength(1);
      });
    }

    it("rejects a stale work-order version when the caller quotes one", async () => {
      const { assetId, workOrderId } = await groundedAsset();
      const response = await post(
        adminToken,
        "release-asset-to-service",
        { assetId, workOrderId },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: "VERSION_CONFLICT", metadata: { currentVersion: 2 } },
      });
      expect(await openIntervals(assetId)).toHaveLength(1);
    });

    it("is not the workshop's call — the maintenance role cannot make it at all", async () => {
      const { assetId, workOrderId } = await groundedAsset({ completerToken: adminToken });
      const response = await post(mechanicToken, "release-asset-to-service", {
        assetId,
        workOrderId,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });
    });
  });
});
