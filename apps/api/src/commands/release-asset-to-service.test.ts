import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { assetAvailabilityIntervals } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

/**
 * Remise en service: the decision that ends a grounding.
 *
 * Two things have to be true before a truck flagged unsafe carries passengers
 * again — the repair is closed and accepted, and a second pair of eyes says so.
 */
describe("release-asset-to-service.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let adminToken: string;
  let managerToken: string;
  let otherWorkspaceWorkOrderId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;

    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;

    const admin = await seedMember(db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    adminToken = (
      await createSession(db, { workspaceId, principalId: admin.principal.id })
    ).token;

    const manager = await seedMember(db, {
      workspaceId,
      role: "OPS_MANAGER",
      allBranches: true,
    });
    managerToken = (
      await createSession(db, { workspaceId, principalId: manager.principal.id })
    ).token;

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
        })
      ).statusCode,
    ).toBe(200);
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

  /**
   * The whole journey: a signalement grounds the truck, a work order fixes it,
   * the workshop closes it. `completerToken` is the member who declares the
   * repair finished — the person the release must differ from.
   */
  async function groundedAsset(
    opts: {
      safetyCritical?: boolean;
      completerToken?: string;
      complete?: boolean;
    } = {},
  ): Promise<{ assetId: string; workOrderId: string }> {
    const assetId = await seedAsset(ctx.app, adminToken);
    const issueId = randomUUID();
    const workOrderId = randomUUID();
    const safetyCritical = opts.safetyCritical ?? true;

    expect(
      (
        await post(managerToken, "report-issue", {
          issueId,
          assetId,
          description: "Plaquettes de frein hors service",
          safetyCritical,
        })
      ).statusCode,
    ).toBe(200);

    expect(
      (
        await post(managerToken, "create-work-order", {
          workOrderId,
          assetId,
          issueId,
          description: "Remplacement du système de freinage",
          expectedCostMinor: 90_000,
        })
      ).statusCode,
    ).toBe(200);

    if (opts.complete !== false) {
      const completed = await post(
        opts.completerToken ?? managerToken,
        "complete-work-order",
        { workOrderId, actualCostMinor: 88_000, summary: "Freins refaits" },
        { expectedVersion: 1 },
      );
      expect(completed.statusCode).toBe(200);
      expect(completed.json()).toMatchObject({ recordStatus: "CLOSED" });
    }

    return { assetId, workOrderId };
  }

  it("closes the grounding when someone other than the mechanic signs it off", async () => {
    const { assetId, workOrderId } = await groundedAsset({
      completerToken: managerToken,
    });
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

  /**
   * §3.4: availability is not lifecycle. The grounding was never a status on
   * the asset, so releasing it leaves nothing on the asset row to check — the
   * open interval is the whole state, and it is gone.
   */
  it("refuses a release when the asset holds no grounding", async () => {
    const { assetId, workOrderId } = await groundedAsset({
      safetyCritical: false,
    });
    expect(await openIntervals(assetId)).toHaveLength(0);

    const response = await post(adminToken, "release-asset-to-service", {
      assetId,
      workOrderId,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "ASSET_NOT_UNAVAILABLE" },
    });
  });

  it("refuses a second release of the same grounding", async () => {
    const { assetId, workOrderId } = await groundedAsset();
    expect(
      (
        await post(adminToken, "release-asset-to-service", {
          assetId,
          workOrderId,
        })
      ).statusCode,
    ).toBe(200);

    const again = await post(adminToken, "release-asset-to-service", {
      assetId,
      workOrderId,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({
      error: { code: "ASSET_NOT_UNAVAILABLE" },
    });
  });

  it("refuses a release on work that is not closed", async () => {
    const { assetId, workOrderId } = await groundedAsset({ complete: false });

    const response = await post(adminToken, "release-asset-to-service", {
      assetId,
      workOrderId,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "WORK_ORDER_NOT_CLOSED", metadata: { status: "OPEN" } },
    });
    expect(await openIntervals(assetId)).toHaveLength(1);
  });

  it("refuses a work order that belongs to another asset", async () => {
    const grounded = await groundedAsset();
    const other = await groundedAsset();

    const response = await post(adminToken, "release-asset-to-service", {
      assetId: grounded.assetId,
      workOrderId: other.workOrderId,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "WORK_ORDER_ASSET_MISMATCH" },
    });
    expect(await openIntervals(grounded.assetId)).toHaveLength(1);
  });

  /** Two pairs of eyes: the mechanic who declared it fixed cannot also clear it. */
  it("refuses the member who declared the safety-critical work complete", async () => {
    const { assetId, workOrderId } = await groundedAsset({
      completerToken: adminToken,
    });

    const response = await post(adminToken, "release-asset-to-service", {
      assetId,
      workOrderId,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "SELF_RELEASE_FORBIDDEN" },
    });
    expect(await openIntervals(assetId)).toHaveLength(1);
  });

  /**
   * The second pair of eyes is bought by the safety flag, not by the release
   * itself. A truck grounded by one report and repaired under a preventive
   * order is the mechanic's own call.
   */
  it("lets the completer release when the linked issue is not safety-critical", async () => {
    const assetId = await seedAsset(ctx.app, adminToken);
    const groundingIssueId = randomUUID();
    const routineIssueId = randomUUID();
    const workOrderId = randomUUID();

    expect(
      (
        await post(managerToken, "report-issue", {
          issueId: groundingIssueId,
          assetId,
          description: "Fuite de frein",
          safetyCritical: true,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post(managerToken, "report-issue", {
          issueId: routineIssueId,
          assetId,
          description: "Essuie-glace usé",
          safetyCritical: false,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post(managerToken, "create-work-order", {
          workOrderId,
          assetId,
          issueId: routineIssueId,
          description: "Changement essuie-glaces",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post(
          adminToken,
          "complete-work-order",
          { workOrderId, actualCostMinor: 4_000 },
          { expectedVersion: 1 },
        )
      ).statusCode,
    ).toBe(200);

    const response = await post(adminToken, "release-asset-to-service", {
      assetId,
      workOrderId,
    });
    expect(response.statusCode).toBe(200);
    expect(await openIntervals(assetId)).toHaveLength(0);
  });

  it("rejects a stale work-order version when the caller quotes one", async () => {
    const { assetId, workOrderId } = await groundedAsset();

    const stale = await post(
      adminToken,
      "release-asset-to-service",
      { assetId, workOrderId },
      { expectedVersion: 1 },
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: { code: "VERSION_CONFLICT", metadata: { currentVersion: 2 } },
    });

    const current = await post(
      adminToken,
      "release-asset-to-service",
      { assetId, workOrderId },
      { expectedVersion: 2 },
    );
    expect(current.statusCode).toBe(200);
  });

  it("cannot release against another workspace's order", async () => {
    const { assetId } = await groundedAsset();

    const response = await post(adminToken, "release-asset-to-service", {
      assetId,
      workOrderId: otherWorkspaceWorkOrderId,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: "REFERENCE_NOT_FOUND",
        metadata: { referenceType: "workOrder" },
      },
    });
    expect(await openIntervals(assetId)).toHaveLength(1);
  });

  it("is not queueable — the maintenance role cannot make this call at all", async () => {
    const maintenance = await seedMember(db, {
      workspaceId,
      role: "MAINTENANCE",
      allBranches: true,
    });
    const maintenanceToken = (
      await createSession(db, {
        workspaceId,
        principalId: maintenance.principal.id,
      })
    ).token;
    const { assetId, workOrderId } = await groundedAsset();

    const response = await post(maintenanceToken, "release-asset-to-service", {
      assetId,
      workOrderId,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });
    expect(await openIntervals(assetId)).toHaveLength(1);
  });
});
