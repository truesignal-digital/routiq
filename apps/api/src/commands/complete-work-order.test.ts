import { randomUUID } from "node:crypto";
import { workOrderDetail } from "@routiq/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db/client.js";
import {
  approvalRules,
  commandSourceArtifacts,
  commands,
  financialEntries,
  financialPostings,
  sourceArtifacts,
  workOrders,
} from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

/**
 * complete-work-order v2 (#81): closing a work order records its cost in the
 * books, in one step. The lines go through record-expense's writer and rules,
 * the order completes in the same transaction, and the order's actual cost is
 * read back from those lines — never typed.
 */
describe("complete-work-order.v2", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let branchId: string;
  let admin: Actor;
  let boris: Actor;
  let mechanic: Actor;
  let approver: Actor;
  let driver: Actor;
  let truck: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;
    branchId = seeded.branch.id;
    admin = await seedActor(db, { workspaceId, role: "ADMIN" });
    boris = await seedActor(db, { workspaceId, role: "TECHNICIAN" });
    mechanic = await seedActor(db, { workspaceId, role: "TECHNICIAN" });
    approver = await seedActor(db, { workspaceId, role: "FINANCE" });
    driver = await seedActor(db, { workspaceId, role: "DRIVER" });
    truck = await seedAsset(ctx.app, admin.token);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function openWorkOrder(assetId = truck): Promise<string> {
    const workOrderId = randomUUID();
    const created = await api.ok(boris.token, "create-work-order", {
      workOrderId,
      assetId,
      description: "Freins avant remplacés",
      expectedCostMinor: 45_000,
    });
    expect(created.recordStatus).toBe("APPROVED");
    return workOrderId;
  }

  function line(amountMinor: number, extra: Record<string, unknown> = {}) {
    return {
      entryId: randomUUID(),
      categoryCode: "REPAIRS",
      amountMinor,
      economicDate: "2026-09-30",
      ...extra,
    };
  }

  function close(
    actor: Actor,
    workOrderId: string,
    payload: Record<string, unknown>,
    envelope: Record<string, unknown> = {},
  ) {
    return api.send(
      actor.token,
      "complete-work-order",
      { workOrderId, ...payload },
      { expectedVersion: 1, ...envelope },
      2,
    );
  }

  async function seedPhoto(owner: Actor): Promise<string> {
    const id = randomUUID();
    await db.insert(sourceArtifacts).values({
      id,
      workspaceId,
      storageKey: `ws/${workspaceId}/finalized-artifacts/${id}/${id.replaceAll("-", "")}`,
      sha256: id.replaceAll("-", ""),
      mimeType: "image/jpeg",
      sizeBytes: 2048n,
      originalFileName: "recu.jpg",
      uploadedByPrincipalId: owner.principalId,
    });
    return id;
  }

  async function readWorkOrder(workOrderId: string) {
    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
    return row!;
  }

  async function entriesOf(workOrderId: string) {
    return db
      .select({
        id: financialEntries.id,
        status: financialEntries.status,
        amountMinor: financialEntries.amountMinor,
        branchId: financialEntries.branchId,
        description: financialEntries.description,
        assetId: financialPostings.assetId,
        workOrderId: financialPostings.workOrderId,
      })
      .from(financialPostings)
      .innerJoin(
        financialEntries,
        and(
          eq(financialEntries.workspaceId, financialPostings.workspaceId),
          eq(financialEntries.id, financialPostings.financialEntryId),
        ),
      )
      .where(eq(financialPostings.workOrderId, workOrderId));
  }

  async function detail(token: string, workOrderId: string) {
    const response = await api.get(token, `/v1/work-orders/${workOrderId}`);
    expect(response.status).toBe(200);
    return workOrderDetail.parse(response.body);
  }

  async function recordCost(workOrderId: string, amountMinor: number): Promise<string> {
    const entryId = randomUUID();
    await api.ok(boris.token, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "REPAIRS",
      economicDate: "2026-09-29",
      amountMinor,
      paymentMethod: "CASH",
      postings: [{ assetId: truck, workOrderId, amountMinor }],
    });
    return entryId;
  }

  /** Above the bound, only an admin's close lands without review. */
  async function withCompletionThreshold<T>(
    amountMinMinor: bigint,
    run: () => Promise<T>,
  ): Promise<T> {
    const [rule] = await db
      .insert(approvalRules)
      .values({
        workspaceId,
        commandType: "complete-work-order",
        categoryCode: null,
        branchId: null,
        amountMinMinor,
        amountMaxMinor: null,
        requiredRole: "ADMIN",
        createdByCommandId: null,
      })
      .returning({ id: approvalRules.id });
    try {
      return await run();
    } finally {
      await db.delete(approvalRules).where(eq(approvalRules.id, rule!.id));
    }
  }

  describe("the three outcomes", () => {
    it("writes one expense for the truck and the order, and derives the actual cost from it", async () => {
      const workOrderId = await openWorkOrder();
      const photo = await seedPhoto(boris);
      const repair = line(50_000, { evidenceArtifactIds: [photo] });

      const response = await close(
        boris,
        workOrderId,
        { costOutcome: "LINES", costLines: [repair], summary: "Plaquettes neuves" },
        { sourceArtifactIds: [photo] },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        recordId: workOrderId,
        rowVersion: 2,
        recordStatus: "COMPLETED",
        // The photo is on the line: no EVIDENCE_MISSING.
        warnings: [],
        children: [
          { entityType: "financial_entry", id: repair.entryId, status: "POSTED", warnings: [] },
        ],
      });

      expect(await entriesOf(workOrderId)).toEqual([
        {
          id: repair.entryId,
          status: "POSTED",
          // XAF has exponent 0: 50 000 francs are 50 000 minor units.
          amountMinor: 50_000n,
          branchId,
          description: "Freins avant remplacés",
          assetId: truck,
          workOrderId,
        },
      ]);
      expect(await readWorkOrder(workOrderId)).toMatchObject({
        status: "COMPLETED",
        costOutcome: "LINES",
        declaredCostMinor: null,
        summary: "Plaquettes neuves",
      });

      const [link] = await db
        .select()
        .from(commandSourceArtifacts)
        .where(eq(commandSourceArtifacts.artifactId, photo));
      const [entry] = await db
        .select({ createdByCommandId: financialEntries.createdByCommandId })
        .from(financialEntries)
        .where(eq(financialEntries.id, repair.entryId));
      // The receipt is the close's file, and the close wrote the entry.
      expect(link?.commandId).toBe(entry?.createdByCommandId);

      const read = await detail(boris.token, workOrderId);
      expect(read.actualCostMinor).toBe(50_000);
      expect(read.costOutcome).toBe("LINES");
      expect(read.declaredCostMinor).toBeNull();
      expect(read.costLines!.map((costLine) => costLine.entryId)).toEqual([repair.entryId]);
    });

    it("records zero cost explicitly with NO_COST", async () => {
      const workOrderId = await openWorkOrder();
      const response = await close(boris, workOrderId, { costOutcome: "NO_COST" });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ recordStatus: "COMPLETED" });
      expect(response.body).not.toHaveProperty("children");
      expect(await entriesOf(workOrderId)).toEqual([]);
      expect(await readWorkOrder(workOrderId)).toMatchObject({ costOutcome: "NO_COST" });
      const read = await detail(boris.token, workOrderId);
      expect(read.actualCostMinor).toBe(0);
      expect(read.costOutcome).toBe("NO_COST");
    });

    it("closes with no cost and marks it pending with INVOICE_PENDING", async () => {
      const workOrderId = await openWorkOrder();
      const response = await close(boris, workOrderId, { costOutcome: "INVOICE_PENDING" });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ recordStatus: "COMPLETED" });
      expect(await entriesOf(workOrderId)).toEqual([]);
      const read = await detail(boris.token, workOrderId);
      expect(read.costOutcome).toBe("INVOICE_PENDING");
      expect(read.actualCostMinor).toBe(0);
    });

    it("refuses a close that says nothing about cost", async () => {
      const workOrderId = await openWorkOrder();
      const response = await close(boris, workOrderId, {});
      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe("VALIDATION_FAILED");
      expect((await readWorkOrder(workOrderId)).status).toBe("APPROVED");
    });

    it("refuses LINES when nothing is recorded and nothing is added", async () => {
      const workOrderId = await openWorkOrder();
      const response = await close(boris, workOrderId, { costOutcome: "LINES" });
      expect(response.status).toBe(422);
      expect(response.body.error?.code).toBe("WORK_ORDER_COST_MISSING");
      expect(await readWorkOrder(workOrderId)).toMatchObject({ status: "APPROVED", rowVersion: 1 });
    });

    it("closes on the lines already recorded, adding nothing", async () => {
      const workOrderId = await openWorkOrder();
      const before = await recordCost(workOrderId, 60_000);

      const response = await close(boris, workOrderId, { costOutcome: "LINES" });
      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty("children");
      expect((await entriesOf(workOrderId)).map((entry) => entry.id)).toEqual([before]);
      expect((await detail(boris.token, workOrderId)).actualCostMinor).toBe(60_000);
    });

    it("adds to the lines already recorded", async () => {
      const workOrderId = await openWorkOrder();
      await recordCost(workOrderId, 60_000);
      const labour = line(25_000, { note: "Main d'œuvre" });

      const response = await close(boris, workOrderId, { costOutcome: "LINES", costLines: [labour] });
      expect(response.status).toBe(200);
      const read = await detail(boris.token, workOrderId);
      expect(read.actualCostMinor).toBe(85_000);
      expect(read.costLines!.find((costLine) => costLine.entryId === labour.entryId)).toMatchObject({
        description: "Main d'œuvre",
        amountMinor: 25_000,
      });
    });

    it("refuses NO_COST once cost is recorded against the order", async () => {
      const workOrderId = await openWorkOrder();
      await recordCost(workOrderId, 60_000);
      const response = await close(boris, workOrderId, { costOutcome: "NO_COST" });
      expect(response.status).toBe(409);
      expect(response.body.error).toMatchObject({
        code: "WORK_ORDER_HAS_COSTS",
        metadata: { recordedCostMinor: 60_000 },
      });
      expect((await readWorkOrder(workOrderId)).status).toBe("APPROVED");
    });
  });

  describe("atomicity", () => {
    it("rolls the close back when a line fails, and keeps none of the lines", async () => {
      const workOrderId = await openWorkOrder();
      const good = line(20_000);
      const bad = line(30_000, { categoryCode: "NOT_A_CATEGORY" });

      const response = await close(boris, workOrderId, {
        costOutcome: "LINES",
        costLines: [good, bad],
      });

      expect(response.status).toBe(422);
      expect(response.body.error).toMatchObject({
        code: "REFERENCE_NOT_FOUND",
        metadata: { referenceType: "expenseCategory" },
      });
      expect(await entriesOf(workOrderId)).toEqual([]);
      expect(
        await db
          .select({ id: financialEntries.id })
          .from(financialEntries)
          .where(inArray(financialEntries.id, [good.entryId, bad.entryId])),
      ).toEqual([]);
      expect(await readWorkOrder(workOrderId)).toMatchObject({
        status: "APPROVED",
        costOutcome: null,
        completedAt: null,
        rowVersion: 1,
      });
    });

    it("rolls every line back when a later line collides with an existing entry", async () => {
      const workOrderId = await openWorkOrder();
      const existing = await recordCost(workOrderId, 10_000);
      const good = line(20_000);

      const response = await close(boris, workOrderId, {
        costOutcome: "LINES",
        costLines: [good, line(30_000, { entryId: existing })],
      });

      expect(response.status).toBe(409);
      expect((await entriesOf(workOrderId)).map((entry) => entry.id)).toEqual([existing]);
      expect((await readWorkOrder(workOrderId)).status).toBe("APPROVED");
    });

    it("writes no line when the close itself is refused", async () => {
      const workOrderId = await openWorkOrder();
      const repair = line(20_000);
      const stale = await close(
        boris,
        workOrderId,
        { costOutcome: "LINES", costLines: [repair] },
        { expectedVersion: 7 },
      );
      expect(stale.status).toBe(409);
      expect(stale.body.error?.code).toBe("VERSION_CONFLICT");
      expect(await entriesOf(workOrderId)).toEqual([]);
    });

    it("replays an exact retry without writing the line twice", async () => {
      const workOrderId = await openWorkOrder();
      const envelope = {
        commandId: randomUUID(),
        idempotencyKey: `close-${randomUUID()}`,
        expectedVersion: 1,
      };
      const payload = { costOutcome: "LINES", costLines: [line(40_000)] };

      const first = await close(boris, workOrderId, payload, envelope);
      const retry = await close(boris, workOrderId, payload, envelope);

      expect(first.status).toBe(200);
      expect(retry.status).toBe(200);
      expect(retry.body).toMatchObject({ idempotentReplay: true, children: first.body.children });
      expect(await entriesOf(workOrderId)).toHaveLength(1);
    });

    it("refuses a file on the envelope that no line claims", async () => {
      const workOrderId = await openWorkOrder();
      const photo = await seedPhoto(boris);
      const response = await close(
        boris,
        workOrderId,
        { costOutcome: "LINES", costLines: [line(20_000)] },
        { sourceArtifactIds: [photo] },
      );
      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe("VALIDATION_FAILED");
      expect(await entriesOf(workOrderId)).toEqual([]);
    });
  });

  describe("approval", () => {
    it("reads the completion band on the derived total: recorded plus added", async () => {
      await withCompletionThreshold(100_000n, async () => {
        const above = await openWorkOrder();
        await recordCost(above, 60_000);
        const held = await close(boris, above, {
          costOutcome: "LINES",
          costLines: [line(50_000)],
        });
        expect(held.body).toMatchObject({ recordStatus: "COMPLETION_SUBMITTED" });
        expect((await detail(boris.token, above)).actualCostMinor).toBe(110_000);

        const below = await openWorkOrder();
        await recordCost(below, 60_000);
        const through = await close(boris, below, {
          costOutcome: "LINES",
          costLines: [line(30_000)],
        });
        expect(through.body).toMatchObject({ recordStatus: "COMPLETED" });
      });
    });

    it("judges each line by record-expense's own band", async () => {
      const workOrderId = await openWorkOrder();
      const small = line(40_000);
      const large = line(150_000);

      const response = await close(boris, workOrderId, {
        costOutcome: "LINES",
        costLines: [small, large],
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        // The completion band has no bound by default: the close lands.
        recordStatus: "COMPLETED",
        children: [
          { id: small.entryId, status: "POSTED" },
          { id: large.entryId, status: "SUBMITTED" },
        ],
      });
      const read = await detail(boris.token, workOrderId);
      // A pending line is still a cost of the repair; only a rejected one is not.
      expect(read.actualCostMinor).toBe(190_000);
      expect(read.pendingCostLines!.map((costLine) => costLine.entryId)).toEqual([large.entryId]);

      await api.ok(approver.token, "reject-entry", { entryId: large.entryId, reason: "Devis" }, {
        expectedVersion: 1,
      });
      expect((await detail(boris.token, workOrderId)).actualCostMinor).toBe(40_000);
    });
  });

  describe("roles", () => {
    it("lets the workshop close with cost lines", async () => {
      const workOrderId = await openWorkOrder();
      const repair = line(35_000);
      const response = await close(mechanic, workOrderId, {
        costOutcome: "LINES",
        costLines: [repair],
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        recordStatus: "COMPLETED",
        // No photo on a receipt-expected category.
        warnings: ["EVIDENCE_MISSING"],
        children: [{ id: repair.entryId, status: "POSTED", warnings: ["EVIDENCE_MISSING"] }],
      });
    });

    it.each([
      ["FINANCE", () => approver],
      ["DRIVER", () => driver],
    ] as const)("refuses a close from %s", async (_role, actor) => {
      const workOrderId = await openWorkOrder();
      const response = await close(actor(), workOrderId, { costOutcome: "NO_COST" });
      expect(response.status).toBe(403);
      expect(response.body.error?.code).toBe("ROLE_FORBIDDEN");
    });
  });

  describe("v1 compatibility", () => {
    it("stores a v1 typed amount as a declaration only, never as cost", async () => {
      const workOrderId = await openWorkOrder();
      const response = await api.send(
        boris.token,
        "complete-work-order",
        { workOrderId, actualCostMinor: 50_000, summary: "Ancien client" },
        { expectedVersion: 1 },
        1,
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ recordStatus: "COMPLETED" });
      expect(await entriesOf(workOrderId)).toEqual([]);
      expect(await readWorkOrder(workOrderId)).toMatchObject({
        declaredCostMinor: 50_000n,
        costOutcome: null,
      });
      const read = await detail(boris.token, workOrderId);
      expect(read.actualCostMinor).toBe(0);
      expect(read.declaredCostMinor).toBe(50_000);
      expect(read.costOutcome).toBeNull();

      const [receipt] = await db
        .select({ version: commands.commandVersion })
        .from(commands)
        .where(eq(commands.id, (response.body as { commandId: string }).commandId));
      expect(receipt?.version).toBe("1");
    });

    it("keeps v1's band: the larger of the declaration and the books", async () => {
      await withCompletionThreshold(100_000n, async () => {
        const workOrderId = await openWorkOrder();
        const response = await api.send(
          boris.token,
          "complete-work-order",
          { workOrderId, actualCostMinor: 150_000 },
          { expectedVersion: 1 },
          1,
        );
        expect(response.body).toMatchObject({ recordStatus: "COMPLETION_SUBMITTED" });
      });
    });
  });
});

describe("complete-work-order.v2 with the books switched off", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("refuses cost lines but still closes with an explicit no-cost", async () => {
    const api = apiClient(ctx.app);
    const { workspace } = await seedWorkspace(ctx.db);
    const admin = await seedActor(ctx.db, { workspaceId: workspace.id, role: "DIRECTOR" });
    const truck = await seedAsset(ctx.app, admin.token);
    await api.ok(admin.token, "disable-module", { moduleCode: "FINANCE" });

    const open = async () => {
      const workOrderId = randomUUID();
      await api.ok(admin.token, "create-work-order", {
        workOrderId,
        assetId: truck,
        description: "Vidange",
        expectedCostMinor: 0,
      });
      return workOrderId;
    };

    const withLine = await api.send(
      admin.token,
      "complete-work-order",
      {
        workOrderId: await open(),
        costOutcome: "LINES",
        costLines: [
          {
            entryId: randomUUID(),
            categoryCode: "REPAIRS",
            amountMinor: 10_000,
            economicDate: "2026-09-30",
          },
        ],
      },
      { expectedVersion: 1 },
      2,
    );
    expect(withLine.status).toBe(403);
    expect(withLine.body.error).toMatchObject({
      code: "MODULE_DISABLED",
      metadata: { module: "FINANCE" },
    });

    const noCost = await api.send(
      admin.token,
      "complete-work-order",
      { workOrderId: await open(), costOutcome: "NO_COST" },
      { expectedVersion: 1 },
      2,
    );
    expect(noCost.status).toBe(200);
  });
});
