import { randomUUID } from "node:crypto";
import { assetAttentionResponse, workOrderDetail } from "@routiq/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db/client.js";
import { commands, financialEntries, postingPeriods, workOrders } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

/**
 * The invoice that arrives after the repair is closed (#82, #531). A COMPLETED
 * work order takes it from the roles that book work-order cost, always held
 * for review whatever the amount, with a reason; the order reads "cost to
 * come" until an approved line settles it. Nothing is reopened or edited.
 */
describe("late repair invoices (#82)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let admin: Actor;
  let director: Actor;
  let technician: Actor;
  let finance: Actor;
  let cashier: Actor;
  let driver: Actor;
  let truck: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;
    admin = await seedActor(db, { workspaceId, role: "ADMIN" });
    director = await seedActor(db, { workspaceId, role: "DIRECTOR" });
    technician = await seedActor(db, { workspaceId, role: "TECHNICIAN" });
    finance = await seedActor(db, { workspaceId, role: "FINANCE" });
    cashier = await seedActor(db, { workspaceId, role: "CASHIER" });
    driver = await seedActor(db, { workspaceId, role: "DRIVER" });
    truck = await seedAsset(ctx.app, admin.token);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function openWorkOrder(): Promise<string> {
    const workOrderId = randomUUID();
    const created = await api.ok(technician.token, "create-work-order", {
      workOrderId,
      assetId: truck,
      description: "Freins avant remplacés",
      expectedCostMinor: 45_000,
    });
    expect(created.recordStatus).toBe("APPROVED");
    return workOrderId;
  }

  /** Opened, then closed by the workshop with "invoice pending" (v2). */
  async function closedInvoicePending(): Promise<string> {
    const workOrderId = await openWorkOrder();
    const closed = await api.ok(
      technician.token,
      "complete-work-order",
      { workOrderId, costOutcome: "INVOICE_PENDING" },
      { expectedVersion: 1 },
      2,
    );
    expect(closed.recordStatus).toBe("COMPLETED");
    return workOrderId;
  }

  function lateInvoice(
    actor: Actor,
    workOrderId: string,
    options: { amountMinor?: number; description?: string | null; economicDate?: string } = {},
  ) {
    const entryId = randomUUID();
    const amountMinor = options.amountMinor ?? 30_000;
    const description =
      options.description === undefined ? "Facture reçue après clôture" : options.description;
    return api
      .send(actor.token, "record-expense", {
        entryId,
        branchCode: "DLA",
        categoryCode: "REPAIRS",
        economicDate: options.economicDate ?? "2026-10-02",
        amountMinor,
        paymentMethod: "CASH",
        ...(description === null ? {} : { description }),
        postings: [{ assetId: truck, workOrderId, amountMinor }],
      })
      .then((reply) => ({ reply, entryId }));
  }

  async function detail(actor: Actor, workOrderId: string) {
    const response = await api.get(actor.token, `/v1/work-orders/${workOrderId}`);
    expect(response.status).toBe(200);
    return workOrderDetail.parse(response.body);
  }

  async function attention(actor: Actor) {
    const response = await api.get(actor.token, `/v1/assets/${truck}/attention`);
    expect(response.status).toBe(200);
    return assetAttentionResponse.parse(response.body).items;
  }

  async function costToComeItems(actor: Actor, workOrderId: string) {
    return (await attention(actor)).filter(
      (item) => item.code === "WORK_ORDER_COST_TO_COME" && item.subject.id === workOrderId,
    );
  }

  async function entry(entryId: string) {
    const [row] = await db.select().from(financialEntries).where(eq(financialEntries.id, entryId));
    return row;
  }

  describe("who may add it, and how it is held", () => {
    it("takes the Administrateur's late invoice and holds it for review, even inside the auto band", async () => {
      const workOrderId = await closedInvoicePending();
      const { reply, entryId } = await lateInvoice(admin, workOrderId, { amountMinor: 5_000 });

      expect(reply.status).toBe(200);
      expect(reply.body.recordStatus).toBe("SUBMITTED");
      const row = await entry(entryId);
      expect(row).toMatchObject({ status: "SUBMITTED", description: "Facture reçue après clôture" });
      // The receipt says so too: the rules never had a say.
      const [receipt] = await db
        .select({ approvalOutcome: commands.approvalOutcome })
        .from(commands)
        .where(eq(commands.id, row!.createdByCommandId));
      expect(receipt?.approvalOutcome).toBe("APPROVAL_REQUIRED");
    });

    it("an order still open takes the same amount without review", async () => {
      const workOrderId = await openWorkOrder();
      const { reply } = await lateInvoice(admin, workOrderId, { amountMinor: 5_000 });
      expect(reply.body.recordStatus).toBe("POSTED");
    });

    it("takes it from Direction and the workshop, held for review", async () => {
      for (const actor of [director, technician]) {
        const workOrderId = await closedInvoicePending();
        const { reply } = await lateInvoice(actor, workOrderId, { amountMinor: 1_000 });
        expect(reply.status).toBe(200);
        expect(reply.body.recordStatus).toBe("SUBMITTED");
      }
    });

    it("refuses Finance, the Cashier and the driver, as on an open order (#410, #414)", async () => {
      const workOrderId = await closedInvoicePending();
      for (const actor of [finance, cashier, driver]) {
        const { reply, entryId } = await lateInvoice(actor, workOrderId);
        expect(reply.status).toBe(403);
        expect(reply.body.error).toMatchObject({
          code: "ROLE_FORBIDDEN",
          metadata: { reason: "WORK_ORDER_COST_FORBIDDEN" },
        });
        expect(await entry(entryId)).toBeUndefined();
      }
    });

    it("needs a reason: no description, or a blank one, is refused and writes nothing", async () => {
      const workOrderId = await closedInvoicePending();
      for (const description of [null, "   "]) {
        const { reply, entryId } = await lateInvoice(admin, workOrderId, { description });
        expect(reply.status).toBe(422);
        expect(reply.body.error).toMatchObject({
          code: "LATE_COST_REASON_REQUIRED",
          metadata: { workOrderId },
        });
        expect(await entry(entryId)).toBeUndefined();
      }
    });

    it("still refuses cost on a cancelled order", async () => {
      const workOrderId = await openWorkOrder();
      await api.ok(
        admin.token,
        "cancel-work-order",
        { workOrderId, reason: "Réparation abandonnée" },
        { expectedVersion: 1 },
      );
      const { reply, entryId } = await lateInvoice(admin, workOrderId);
      expect(reply.status).toBe(409);
      expect(reply.body.error).toMatchObject({
        code: "WORK_ORDER_NOT_OPEN",
        metadata: { workOrderId, status: "CANCELLED" },
      });
      expect(await entry(entryId)).toBeUndefined();
    });

    it("an edit by its author cannot move it into the auto band, nor drop the reason", async () => {
      const workOrderId = await closedInvoicePending();
      const { entryId } = await lateInvoice(admin, workOrderId, { amountMinor: 40_000 });
      const edit = (amountMinor: number, description?: string) =>
        api.send(
          admin.token,
          "update-pending-entry",
          {
            entryId,
            categoryCode: "REPAIRS",
            economicDate: "2026-10-02",
            amountMinor,
            paymentMethod: "CASH",
            ...(description === undefined ? {} : { description }),
            postings: [{ assetId: truck, workOrderId, amountMinor }],
          },
          { expectedVersion: 1 },
        );

      const noReason = await edit(2_000);
      expect(noReason.status).toBe(422);
      expect(noReason.body.error?.code).toBe("LATE_COST_REASON_REQUIRED");

      const smaller = await edit(2_000, "Facture reçue après clôture, montant corrigé");
      expect(smaller.status).toBe(200);
      expect(smaller.body.recordStatus).toBe("SUBMITTED");
      expect(await entry(entryId)).toMatchObject({ status: "SUBMITTED", amountMinor: 2_000n });
    });
  });

  describe("cost to come, derived on read", () => {
    it("closed with invoice pending → flagged → invoice added → Finance approves → cleared, actual cost updated", async () => {
      const workOrderId = await closedInvoicePending();

      expect((await detail(admin, workOrderId)).costToCome).toEqual({
        reason: "INVOICE_PENDING",
        awaitingApproval: false,
      });
      const [flagged] = await costToComeItems(technician, workOrderId);
      expect(flagged).toMatchObject({
        severity: "WARNING",
        partOfGrounding: false,
        params: { description: "Freins avant remplacés", currency: "XAF" },
      });

      const { reply, entryId } = await lateInvoice(technician, workOrderId, { amountMinor: 62_000 });
      expect(reply.body.recordStatus).toBe("SUBMITTED");

      // Waiting for Finance: still to come on the order, and on the truck it
      // is the entry's review that shows, not a second item.
      const waiting = await detail(admin, workOrderId);
      expect(waiting.costToCome).toEqual({ reason: "INVOICE_PENDING", awaitingApproval: true });
      expect(waiting.pendingCostLines?.map((line) => line.entryId)).toContain(entryId);
      expect(await costToComeItems(technician, workOrderId)).toEqual([]);
      expect(
        (await attention(finance)).some(
          (item) => item.code === "ENTRY_AWAITING_REVIEW" && item.subject.id === entryId,
        ),
      ).toBe(true);

      await api.ok(finance.token, "approve-entry", { entryId }, { expectedVersion: 1 });

      const settled = await detail(admin, workOrderId);
      expect(settled.costToCome).toBeNull();
      expect(settled.actualCostMinor).toBe(62_000);
      expect(settled.status).toBe("COMPLETED");
      expect(await costToComeItems(technician, workOrderId)).toEqual([]);
    });

    it("a rejected late invoice leaves the cost to come", async () => {
      const workOrderId = await closedInvoicePending();
      const { entryId } = await lateInvoice(admin, workOrderId);
      await api.ok(
        finance.token,
        "reject-entry",
        { entryId, reason: "Mauvais montant" },
        { expectedVersion: 1 },
      );
      expect((await detail(admin, workOrderId)).costToCome).toEqual({
        reason: "INVOICE_PENDING",
        awaitingApproval: false,
      });
      expect(await costToComeItems(admin, workOrderId)).toHaveLength(1);
    });

    it("a reversed late invoice brings the cost to come back", async () => {
      const workOrderId = await closedInvoicePending();
      const { entryId } = await lateInvoice(admin, workOrderId);
      await api.ok(finance.token, "approve-entry", { entryId }, { expectedVersion: 1 });
      expect((await detail(admin, workOrderId)).costToCome).toBeNull();

      await api.ok(
        finance.token,
        "reverse-entry",
        { originalEntryId: entryId, reversalEntryId: randomUUID(), reason: "Facture en double" },
        { expectedVersion: 2 },
      );
      expect((await detail(admin, workOrderId)).costToCome).toMatchObject({
        reason: "INVOICE_PENDING",
      });
    });

    it("lines recorded before the close do not settle an invoice-pending close", async () => {
      const workOrderId = await openWorkOrder();
      const { reply } = await lateInvoice(admin, workOrderId, { amountMinor: 5_000, description: "Acompte" });
      expect(reply.body.recordStatus).toBe("POSTED");
      await api.ok(
        technician.token,
        "complete-work-order",
        { workOrderId, costOutcome: "INVOICE_PENDING" },
        { expectedVersion: 1 },
        2,
      );
      expect((await detail(admin, workOrderId)).costToCome).toEqual({
        reason: "INVOICE_PENDING",
        awaitingApproval: false,
      });
    });

    it("a line still pending from before the close is not the awaited invoice", async () => {
      const workOrderId = await openWorkOrder();
      const { reply } = await lateInvoice(technician, workOrderId, {
        amountMinor: 900_000,
        description: "Pièces commandées",
      });
      expect(reply.body.recordStatus).toBe("SUBMITTED");
      await api.ok(
        technician.token,
        "complete-work-order",
        { workOrderId, costOutcome: "INVOICE_PENDING" },
        { expectedVersion: 1 },
        2,
      );
      expect((await detail(admin, workOrderId)).costToCome).toEqual({
        reason: "INVOICE_PENDING",
        awaitingApproval: false,
      });
      expect(await costToComeItems(technician, workOrderId)).toHaveLength(1);
    });

    it("a close with its lines, or with no cost, has nothing to come", async () => {
      const withLines = await openWorkOrder();
      await api.ok(
        technician.token,
        "complete-work-order",
        {
          workOrderId: withLines,
          costOutcome: "LINES",
          costLines: [
            { entryId: randomUUID(), categoryCode: "REPAIRS", amountMinor: 8_000, economicDate: "2026-10-02" },
          ],
        },
        { expectedVersion: 1 },
        2,
      );
      const noCost = await openWorkOrder();
      await api.ok(
        technician.token,
        "complete-work-order",
        { workOrderId: noCost, costOutcome: "NO_COST" },
        { expectedVersion: 1 },
        2,
      );
      expect((await detail(admin, withLines)).costToCome).toBeNull();
      expect((await detail(admin, noCost)).costToCome).toBeNull();
      expect(await costToComeItems(admin, withLines)).toEqual([]);
      expect(await costToComeItems(admin, noCost)).toEqual([]);
    });

    it("a v1 close that declared 50 000 with nothing recorded reads 'declared 50 000, recorded 0'", async () => {
      const workOrderId = await openWorkOrder();
      await api.ok(
        technician.token,
        "complete-work-order",
        { workOrderId, actualCostMinor: 50_000 },
        { expectedVersion: 1 },
        1,
      );

      expect((await detail(admin, workOrderId)).costToCome).toEqual({
        reason: "DECLARED_NOT_RECORDED",
        declaredCostMinor: 50_000,
        recordedCostMinor: 0,
        awaitingApproval: false,
      });
      const [item] = await costToComeItems(admin, workOrderId);
      expect(item?.params).toMatchObject({ declaredCostMinor: 50_000, recordedCostMinor: 0 });

      const { entryId } = await lateInvoice(admin, workOrderId, { amountMinor: 50_000 });
      await api.ok(finance.token, "approve-entry", { entryId }, { expectedVersion: 1 });
      expect((await detail(admin, workOrderId)).costToCome).toBeNull();
    });

    it("a caller who may not read work-order costs sees neither the flag nor the item (#390)", async () => {
      const workOrderId = await closedInvoicePending();
      expect((await detail(driver, workOrderId)).costToCome).toBeNull();
      expect(await costToComeItems(driver, workOrderId)).toEqual([]);
    });
  });

  describe("Record again after a wrong-details cancellation (#610)", () => {
    it("takes the replacement of a completed order's cost, held for review like any late cost", async () => {
      const workOrderId = await openWorkOrder();
      const { entryId: original, reply } = await lateInvoice(director, workOrderId, {
        amountMinor: 310_000,
        description: "Freins, facture garage",
      });
      expect(reply.body.recordStatus).toBe("POSTED");
      await api.ok(
        technician.token,
        "complete-work-order",
        { workOrderId, costOutcome: "LINES" },
        { expectedVersion: 1 },
        2,
      );

      await api.ok(
        director.token,
        "reverse-entry",
        { originalEntryId: original, reversalEntryId: randomUUID(), reasonCode: "WRONG_DETAILS" },
        { expectedVersion: 1 },
        2,
      );
      // The form pre-fills the cancelled entry's description, which carries the reason.
      const { reply: again, entryId } = await lateInvoice(director, workOrderId, {
        amountMinor: 300_000,
        description: "Freins, facture garage",
      });
      expect(again.status).toBe(200);
      expect(again.body.recordStatus).toBe("SUBMITTED");
      await api.ok(finance.token, "approve-entry", { entryId }, { expectedVersion: 1 });
      expect((await detail(admin, workOrderId)).actualCostMinor).toBe(300_000);
    });
  });

  describe("period lock", () => {
    it("a late invoice dated in a locked month posts in an open month and keeps its date", async () => {
      const workOrderId = await closedInvoicePending();
      await api.ok(finance.token, "lock-period", { periodCode: "2025-02" });

      const { entryId } = await lateInvoice(admin, workOrderId, { economicDate: "2025-02-14" });
      const approved = await api.ok(finance.token, "approve-entry", { entryId }, { expectedVersion: 1 });
      expect(approved.warnings).toContain("LATE_POSTING");

      const row = await entry(entryId);
      expect(row).toMatchObject({ status: "POSTED", economicDate: "2025-02-14", isLatePosting: true });
      const [period] = await db
        .select({ periodCode: postingPeriods.periodCode, status: postingPeriods.status })
        .from(postingPeriods)
        .where(eq(postingPeriods.id, row!.postingPeriodId!));
      expect(period?.status).toBe("OPEN");
      expect(period?.periodCode).not.toBe("2025-02");
      expect((await detail(admin, workOrderId)).costToCome).toBeNull();
    });
  });

  it("never touches the work order itself", async () => {
    const workOrderId = await closedInvoicePending();
    const [before] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
    const { entryId } = await lateInvoice(admin, workOrderId);
    await api.ok(finance.token, "approve-entry", { entryId }, { expectedVersion: 1 });
    const [after] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
    expect(after).toEqual(before);
  });
});
