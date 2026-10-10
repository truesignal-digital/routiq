import { randomUUID } from "node:crypto";
import {
  assetAttentionResponse,
  assetDetail,
  financialEntryListResponse,
  issueDetail,
  issueListResponse,
  vehicleHistoryResponse,
  workOrderDetail,
  workOrderListResponse,
} from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

/**
 * Work orders and problems carry a per-workspace number (#608), drawn by the
 * server when the creating command commits. The UUID stays the key; the
 * prefix ("OT-", "WO-") is the client's words, so the reads publish a plain
 * integer.
 */
describe("work order and problem numbers (#608)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let admin: Actor;
  let other: Actor;
  let truck: string;
  let otherTruck: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    admin = await seedActor(ctx.db, { workspaceId: seeded.workspace.id, role: "ADMIN" });
    truck = await seedAsset(ctx.app, admin.token);

    const otherSeeded = await seedWorkspace(ctx.db);
    other = await seedActor(ctx.db, { workspaceId: otherSeeded.workspace.id, role: "ADMIN" });
    otherTruck = await seedAsset(ctx.app, other.token);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function reportIssue(actor: Actor, assetId: string, safetyCritical = false) {
    const issueId = randomUUID();
    await api.ok(actor.token, "report-issue", {
      issueId,
      assetId,
      description: `Problème ${issueId.slice(0, 4)}`,
      safetyCritical,
    });
    return issueId;
  }

  async function createWorkOrder(actor: Actor, assetId: string, issueId?: string) {
    const workOrderId = randomUUID();
    await api.ok(actor.token, "create-work-order", {
      workOrderId,
      assetId,
      ...(issueId === undefined ? {} : { issueId }),
      description: `Réparation ${workOrderId.slice(0, 4)}`,
      expectedCostMinor: 0,
    });
    return workOrderId;
  }

  async function workOrderNumber(actor: Actor, id: string) {
    const response = await api.get(actor.token, `/v1/work-orders/${id}`);
    expect(response.status).toBe(200);
    return workOrderDetail.parse(response.body).number;
  }

  async function issueNumber(actor: Actor, id: string) {
    const response = await api.get(actor.token, `/v1/issues/${id}`);
    expect(response.status).toBe(200);
    return issueDetail.parse(response.body).number;
  }

  describe("allocation", () => {
    let firstIssue: number | null;

    it("numbers problems and work orders on separate sequences, one after the other", async () => {
      const issues = [];
      for (let i = 0; i < 3; i += 1) issues.push(await reportIssue(admin, truck));
      const orders = [];
      for (let i = 0; i < 2; i += 1) orders.push(await createWorkOrder(admin, truck));

      const issueNumbers = await Promise.all(issues.map((id) => issueNumber(admin, id)));
      const orderNumbers = await Promise.all(orders.map((id) => workOrderNumber(admin, id)));
      firstIssue = issueNumbers[0] ?? null;
      expect(firstIssue).not.toBeNull();
      expect(issueNumbers).toEqual([firstIssue, firstIssue! + 1, firstIssue! + 2]);
      expect(orderNumbers[1]).toBe(orderNumbers[0]! + 1);
    });

    it("starts another workspace at 1: no sequence is shared across tenants", async () => {
      const issueId = await reportIssue(other, otherTruck);
      const workOrderId = await createWorkOrder(other, otherTruck);
      expect(await issueNumber(other, issueId)).toBe(1);
      expect(await workOrderNumber(other, workOrderId)).toBe(1);
    });

    it("never hands two concurrent creates the same number", async () => {
      const ids = await Promise.all(Array.from({ length: 6 }, () => reportIssue(admin, truck)));
      const orderIds = await Promise.all(Array.from({ length: 6 }, () => createWorkOrder(admin, truck)));

      const issueNumbers = await Promise.all(ids.map((id) => issueNumber(admin, id)));
      const orderNumbers = await Promise.all(orderIds.map((id) => workOrderNumber(admin, id)));
      for (const numbers of [issueNumbers, orderNumbers]) {
        const sorted = [...numbers].map(Number).sort((a, b) => a - b);
        expect(new Set(sorted).size).toBe(6);
        // Contiguous: a draw is part of the command's transaction, so nothing is skipped.
        expect(sorted.at(-1)! - sorted[0]!).toBe(5);
      }
    });

    it("spends no number on a refused command", async () => {
      const before = await createWorkOrder(admin, truck);
      const refused = await api.send(admin.token, "create-work-order", {
        workOrderId: randomUUID(),
        assetId: truck,
        issueId: randomUUID(),
        description: "Référence inconnue",
        expectedCostMinor: 0,
      });
      expect(refused.status).toBe(422);
      const after = await createWorkOrder(admin, truck);
      expect(await workOrderNumber(admin, after)).toBe((await workOrderNumber(admin, before))! + 1);
    });

    it("keeps the number on an idempotent replay", async () => {
      const workOrderId = randomUUID();
      const envelope = { idempotencyKey: `replay-${workOrderId}`, commandId: randomUUID() };
      const payload = { workOrderId, assetId: truck, description: "Rejoué", expectedCostMinor: 0 };
      await api.ok(admin.token, "create-work-order", payload, envelope);
      const first = await workOrderNumber(admin, workOrderId);
      const replay = await api.ok(admin.token, "create-work-order", payload, envelope);
      expect(replay.idempotentReplay).toBe(true);
      const next = await createWorkOrder(admin, truck);
      expect(await workOrderNumber(admin, workOrderId)).toBe(first);
      expect(await workOrderNumber(admin, next)).toBe(first! + 1);
    });
  });

  describe("reads", () => {
    let assetId: string;
    let issueId: string;
    let workOrderId: string;
    let issueNo: number;
    let orderNo: number;

    beforeAll(async () => {
      assetId = await seedAsset(ctx.app, admin.token);
      issueId = await reportIssue(admin, assetId, true);
      workOrderId = await createWorkOrder(admin, assetId, issueId);
      issueNo = (await issueNumber(admin, issueId))!;
      orderNo = (await workOrderNumber(admin, workOrderId))!;
      await api.ok(admin.token, "record-expense", {
        entryId: randomUUID(),
        branchCode: "DLA",
        categoryCode: "REPAIRS",
        economicDate: "2026-08-20",
        amountMinor: 15_000,
        paymentMethod: "CASH",
        postings: [{ assetId, workOrderId, amountMinor: 15_000 }],
      });
    });

    it("puts both numbers on the work order and its problem", async () => {
      const response = await api.get(admin.token, `/v1/work-orders/${workOrderId}`);
      const detail = workOrderDetail.parse(response.body);
      expect(detail.number).toBe(orderNo);
      expect(detail.issue).toMatchObject({ id: issueId, number: issueNo });

      const list = workOrderListResponse.parse(
        (await api.get(admin.token, `/v1/work-orders?assetId=${assetId}`)).body,
      );
      expect(list.items.find((item) => item.id === workOrderId)).toMatchObject({
        number: orderNo,
        issue: { id: issueId, number: issueNo },
      });
    });

    it("puts both numbers on the problem and the work orders it spawned", async () => {
      const detail = issueDetail.parse((await api.get(admin.token, `/v1/issues/${issueId}`)).body);
      expect(detail.number).toBe(issueNo);
      expect(detail.workOrders).toEqual([expect.objectContaining({ id: workOrderId, number: orderNo })]);

      const list = issueListResponse.parse(
        (await api.get(admin.token, `/v1/issues?assetId=${assetId}`)).body,
      );
      expect(list.items.find((item) => item.id === issueId)).toMatchObject({
        number: issueNo,
        workOrders: [{ id: workOrderId, number: orderNo }],
      });
    });

    it("names the grounding problem and its work orders by number on the vehicle", async () => {
      const detail = assetDetail.parse((await api.get(admin.token, `/v1/assets/${assetId}`)).body);
      expect(detail.availability.state).toBe("GROUNDED");
      if (detail.availability.state !== "GROUNDED") return;
      expect(detail.availability.issue.number).toBe(issueNo);
      expect(detail.availability.workOrders).toEqual([
        expect.objectContaining({ id: workOrderId, number: orderNo }),
      ]);
    });

    it("carries the number in the attention items about a problem or a work order", async () => {
      const attention = assetAttentionResponse.parse(
        (await api.get(admin.token, `/v1/assets/${assetId}/attention`)).body,
      );
      const numbered = attention.items.filter(
        (item) => item.subject.entityType === "work_order" || item.subject.entityType === "operational_issue",
      );
      expect(numbered.length).toBeGreaterThan(0);
      for (const item of numbered) {
        expect(item.params.recordNumber).toBe(
          item.subject.entityType === "work_order" ? orderNo : issueNo,
        );
      }
    });

    it("carries the number in the vehicle history", async () => {
      const history = vehicleHistoryResponse.parse(
        (await api.get(admin.token, `/v1/assets/${assetId}/history?kind=MAINTENANCE`)).body,
      );
      const reported = history.items.find((item) => item.eventType === "operational_issue.reported");
      const created = history.items.find((item) => item.subject.entityType === "work_order");
      expect(reported?.params["recordNumber"]).toBe(issueNo);
      expect(created?.params["recordNumber"]).toBe(orderNo);
    });

    it("names the work order by number on the vehicle's money", async () => {
      const response = await api.get(admin.token, `/v1/finance/entries?assetId=${assetId}`);
      const [entry] = financialEntryListResponse.parse(response.body).entries;
      expect(entry?.assetLinks).toMatchObject({ workOrderId, workOrderNumber: orderNo });
      expect(entry?.links).toMatchObject({ workOrderId, workOrderNumber: orderNo });
    });
  });
});
