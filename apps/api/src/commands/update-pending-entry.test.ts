import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db/client.js";
import { auditEvents, financialEntries, financialPostings } from "../db/schema.js";
import { inWorkspace } from "../db/tenant.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedWorkspace } from "../test/seed.js";
import { currentPeriodCode } from "./periods.js";

/** #85: the author edits their own pending entry; nobody else, and nothing decided. */
describe("update-pending-entry.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let assetId: string;
  let author: Actor;
  let colleague: Actor;
  let approver: Actor;
  let admin: Actor;
  let cashier: Actor;
  const economicDate = `${currentPeriodCode(new Date(), "Africa/Douala")}-15`;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
    api = apiClient(ctx.app);
    workspaceId = (await seedWorkspace(db)).workspace.id;
    [author, colleague, approver, admin, cashier] = await Promise.all([
      seedActor(db, { workspaceId, role: "DRIVER", allBranches: true }),
      seedActor(db, { workspaceId, role: "DRIVER", allBranches: true }),
      seedActor(db, { workspaceId, role: "FINANCE", allBranches: true }),
      seedActor(db, { workspaceId, role: "DIRECTOR", allBranches: true }),
      // Revenue is the counter's to record now, no longer the driver's.
      seedActor(db, { workspaceId, role: "CASHIER", allBranches: true }),
    ]);
    assetId = randomUUID();
    await api.ok(admin.token, "register-asset", {
      assetId,
      assetCode: `EDIT-${assetId.slice(0, 6)}`,
      assetClassCode: "TRUCK",
      templateCode: "TRUCKING",
      branchCode: "DLA",
    });
  });

  afterAll(async () => {
    await ctx?.close();
  });

  /** A DRIVER expense: above the 100 000 band it waits for approval. */
  async function recordExpense(amountMinor: number, by: Actor = author) {
    const entryId = randomUUID();
    const outcome = await api.ok(by.token, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate,
      counterpartyName: "Station Akwa",
      amountMinor,
      paymentMethod: "CASH",
      postings: [{ assetId, amountMinor }],
    });
    return { entryId, outcome };
  }

  function edit(
    by: Actor,
    entryId: string,
    changes: Record<string, unknown> & { amountMinor?: number },
    expectedVersion?: number,
  ) {
    const amountMinor = changes.amountMinor ?? 150_000;
    return api.send(
      by.token,
      "update-pending-entry",
      {
        entryId,
        categoryCode: "FUEL",
        economicDate,
        counterpartyName: "Station Akwa",
        paymentMethod: "CASH",
        postings: [{ assetId, amountMinor }],
        ...changes,
        amountMinor,
      },
      expectedVersion === undefined ? {} : { expectedVersion },
    );
  }

  const entryRow = async (entryId: string) => {
    const [row] = await db
      .select()
      .from(financialEntries)
      .where(and(eq(financialEntries.workspaceId, workspaceId), eq(financialEntries.id, entryId)));
    return row;
  };

  const lines = (entryId: string) =>
    db
      .select()
      .from(financialPostings)
      .where(and(eq(financialPostings.workspaceId, workspaceId), eq(financialPostings.financialEntryId, entryId)))
      .orderBy(asc(financialPostings.lineNo));

  const events = (entryId: string) =>
    db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.workspaceId, workspaceId),
          eq(auditEvents.entityType, "financial_entry"),
          eq(auditEvents.entityId, entryId),
        ),
      )
      .orderBy(asc(auditEvents.occurredAt));

  describe("the author, while the entry waits", () => {
    it("changes the amount in place and replaces the line, keeping number and id", async () => {
      const { entryId } = await recordExpense(145_000);
      const before = await entryRow(entryId);
      const [oldLine] = await lines(entryId);

      const reply = await edit(author, entryId, { amountMinor: 154_000 }, 1);

      expect(reply.status, JSON.stringify(reply.body)).toBe(200);
      expect(reply.body).toMatchObject({ recordId: entryId, rowVersion: 2, recordStatus: "SUBMITTED" });
      const after = await entryRow(entryId);
      expect(after).toMatchObject({
        status: "SUBMITTED",
        amountMinor: 154_000n,
        rowVersion: 2,
        entryNumber: before?.entryNumber,
        createdByCommandId: before?.createdByCommandId,
        postingPeriodId: null,
      });
      const newLines = await lines(entryId);
      expect(newLines).toHaveLength(1);
      expect(newLines[0]).toMatchObject({ amountMinor: 154_000n, assetId, lineNo: 1 });
      expect(newLines[0]?.id).not.toBe(oldLine?.id);
    });

    it("keeps the postings summing to the entry", async () => {
      const { entryId } = await recordExpense(150_000);
      await expect(edit(author, entryId, { amountMinor: 160_000 }, 1)).resolves.toMatchObject({ status: 200 });

      const [row] = (await db.execute(sql`
        select e.amount_minor::text as amount, sum(p.amount_minor)::text as posted
        from financial_entries e join financial_postings p on p.financial_entry_id = e.id
        where e.id = ${entryId} group by e.amount_minor
      `)).rows as { amount: string; posted: string }[];
      expect(row).toEqual({ amount: "160000", posted: "160000" });
    });

    it("refuses lines that do not sum to the new amount", async () => {
      const { entryId } = await recordExpense(150_000);
      const reply = await edit(author, entryId, { amountMinor: 160_000, postings: [{ assetId, amountMinor: 150_000 }] }, 1);
      expect(reply.status).toBe(422);
      expect(reply.body.error?.code).toBe("POSTINGS_SUM_MISMATCH");
      expect((await entryRow(entryId))?.amountMinor).toBe(150_000n);
    });

    it("refuses a category of the other direction", async () => {
      const { entryId } = await recordExpense(150_000);
      const reply = await edit(author, entryId, { categoryCode: "FREIGHT_REVENUE" }, 1);
      expect(reply.status).toBe(422);
      expect(reply.body.error?.code).toBe("CATEGORY_KIND_MISMATCH");
    });

    it("clears an optional field left out, and keeps unchanged lines as they were", async () => {
      const { entryId } = await recordExpense(150_000);
      const [oldLine] = await lines(entryId);

      const reply = await edit(author, entryId, { counterpartyName: undefined, description: "Gasoil, plein" }, 1);

      expect(reply.status, JSON.stringify(reply.body)).toBe(200);
      expect(await entryRow(entryId)).toMatchObject({ counterpartyName: null, description: "Gasoil, plein" });
      const [line] = await lines(entryId);
      expect(line?.id).toBe(oldLine?.id);
      const updated = (await events(entryId)).find((event) => event.eventType === "financial_entry.updated");
      expect(updated?.changedFields).toEqual(["counterpartyName", "description", "rowVersion"]);
    });

    it("writes the before and after an approver reads in the entry's history", async () => {
      const { entryId } = await recordExpense(145_000);
      const [oldLine] = await lines(entryId);
      await expect(edit(author, entryId, { amountMinor: 154_000 }, 1)).resolves.toMatchObject({ status: 200 });

      const updated = (await events(entryId)).find((event) => event.eventType === "financial_entry.updated");
      expect(updated).toMatchObject({
        actorPrincipalId: author.principalId,
        changedFields: ["amountMinor", "postings", "rowVersion"],
        beforeState: expect.objectContaining({ amountMinor: 145_000, status: "SUBMITTED", rowVersion: 1 }),
        afterState: expect.objectContaining({ amountMinor: 154_000, status: "SUBMITTED", rowVersion: 2 }),
      });
      // The replaced line exists nowhere else now.
      expect((updated?.beforeState as { postings: unknown[] }).postings).toEqual([
        expect.objectContaining({ id: oldLine?.id, amountMinor: 145_000, assetId }),
      ]);

      const list = await api.get(approver.token, `/v1/history/financial_entry/${entryId}`);
      expect(list.status).toBe(200);
      const items = (list.body as { items: Array<{ eventId: string; eventType: string }> }).items;
      const item = items.find((candidate) => candidate.eventType === "financial_entry.updated");
      expect(item).toBeDefined();
      const diff = await api.get(approver.token, `/v1/history/financial_entry/${entryId}/${item?.eventId}`);
      expect(diff.status).toBe(200);
      expect((diff.body as { changes: unknown[] }).changes).toContainEqual({
        field: "amountMinor",
        kind: "MONEY",
        before: 145_000,
        after: 154_000,
      });
    });

    it("lets the approver decide the edited entry at its new version", async () => {
      const { entryId } = await recordExpense(150_000);
      await expect(edit(author, entryId, { amountMinor: 170_000 }, 1)).resolves.toMatchObject({ status: 200 });

      const approved = await api.send(approver.token, "approve-entry", { entryId }, { expectedVersion: 2 });
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      const [line] = await lines(entryId);
      expect(line?.postingPeriodId).not.toBeNull();
      expect(await entryRow(entryId)).toMatchObject({ status: "POSTED", amountMinor: 170_000n });
    });
  });

  describe("the approval rules, run again on the new amount", () => {
    it("posts an entry edited into the auto-approve band", async () => {
      const { entryId, outcome } = await recordExpense(145_000);
      expect(outcome.recordStatus).toBe("SUBMITTED");

      const reply = await edit(author, entryId, { amountMinor: 54_000 }, 1);

      expect(reply.status, JSON.stringify(reply.body)).toBe(200);
      expect(reply.body).toMatchObject({ recordStatus: "POSTED", rowVersion: 2 });
      const row = await entryRow(entryId);
      expect(row).toMatchObject({ status: "POSTED", amountMinor: 54_000n });
      expect(row?.postingPeriodId).not.toBeNull();
      expect(row?.postedAt).toBeInstanceOf(Date);
      const [line] = await lines(entryId);
      expect(line?.postingPeriodId).toBe(row?.postingPeriodId);
      // One transaction stamps both of the edit's events with the same time.
      expect((await events(entryId)).map((event) => event.eventType).sort()).toEqual([
        "financial_entry.posted",
        "financial_entry.submitted",
        "financial_entry.updated",
      ]);
    });

    it("leaves an entry still above the band waiting", async () => {
      const { entryId } = await recordExpense(150_000);
      const reply = await edit(author, entryId, { amountMinor: 120_000 }, 1);
      expect(reply.status).toBe(200);
      expect(reply.body.recordStatus).toBe("SUBMITTED");
    });

    it("posts an unchanged amount once the tenant raises record-expense's threshold", async () => {
      const { entryId } = await recordExpense(150_000);
      await api.ok(admin.token, "update-approval-threshold", {
        commandType: "record-expense",
        amountMaxMinor: 200_000,
      });
      try {
        const reply = await edit(author, entryId, { amountMinor: 150_000, description: "relu" }, 1);
        expect(reply.status, JSON.stringify(reply.body)).toBe(200);
        expect(reply.body.recordStatus).toBe("POSTED");
      } finally {
        await api.ok(admin.token, "update-approval-threshold", {
          commandType: "record-expense",
          amountMaxMinor: 100_000,
        });
      }
    });

    it("reads a revenue entry against record-revenue's band", async () => {
      const entryId = randomUUID();
      const recorded = await api.ok(cashier.token, "record-revenue", {
        entryId,
        branchCode: "DLA",
        categoryCode: "FREIGHT_REVENUE",
        economicDate,
        amountMinor: 250_000,
        paymentMethod: "CASH",
        postings: [{ assetId, amountMinor: 250_000 }],
      });
      expect(recorded.recordStatus).toBe("SUBMITTED");

      const reply = await edit(
        cashier,
        entryId,
        { categoryCode: "FREIGHT_REVENUE", counterpartyName: undefined, amountMinor: 25_000 },
        1,
      );

      expect(reply.status, JSON.stringify(reply.body)).toBe(200);
      expect(reply.body.recordStatus).toBe("POSTED");
      expect(await entryRow(entryId)).toMatchObject({ direction: "REVENUE", amountMinor: 25_000n });
    });
  });

  describe("who may edit", () => {
    it("refuses another field submitter", async () => {
      const { entryId } = await recordExpense(150_000);
      const reply = await edit(colleague, entryId, { amountMinor: 1_000 }, 1);
      expect(reply.status).toBe(403);
      expect(reply.body.error?.code).toBe("NOT_ENTRY_AUTHOR");
      expect((await entryRow(entryId))?.amountMinor).toBe(150_000n);
    });

    it("refuses Direction, who may reject it instead", async () => {
      const { entryId } = await recordExpense(150_000);
      const reply = await edit(admin, entryId, { amountMinor: 1_000 }, 1);
      expect(reply.status).toBe(403);
      expect(reply.body.error?.code).toBe("NOT_ENTRY_AUTHOR");

      const rejected = await api.send(admin.token, "reject-entry", { entryId, reason: "montant faux" }, {
        expectedVersion: 1,
      });
      expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    });

    it("refuses a driver who moves their entry onto a work order (#410)", async () => {
      const workOrderId = randomUUID();
      await api.ok(admin.token, "create-work-order", {
        workOrderId,
        assetId,
        description: "Plaquettes de frein",
        expectedCostMinor: 60_000,
      });
      const { entryId } = await recordExpense(150_000);
      const reply = await edit(
        author,
        entryId,
        { amountMinor: 150_000, postings: [{ assetId, workOrderId, amountMinor: 150_000 }] },
        1,
      );
      expect(reply.status).toBe(403);
      expect(reply.body.error?.code).toBe("ROLE_FORBIDDEN");
      expect((await lines(entryId)).map((line) => line.workOrderId)).toEqual([null]);
    });

    it("refuses an approver", async () => {
      const { entryId } = await recordExpense(150_000);
      const reply = await edit(approver, entryId, { amountMinor: 1_000 }, 1);
      expect(reply.status).toBe(403);
      expect(reply.body.error?.code).toBe("NOT_ENTRY_AUTHOR");
    });
  });

  describe("only while nobody has decided", () => {
    it("answers VERSION_CONFLICT when an approver acted first", async () => {
      const { entryId } = await recordExpense(150_000);
      await api.ok(approver.token, "approve-entry", { entryId }, { expectedVersion: 1 });

      const reply = await edit(author, entryId, { amountMinor: 160_000 }, 1);

      expect(reply.status).toBe(409);
      expect(reply.body.error?.code).toBe("VERSION_CONFLICT");
      expect(await entryRow(entryId)).toMatchObject({ status: "POSTED", amountMinor: 150_000n });
    });

    it("refuses an approved entry even at its current version", async () => {
      const { entryId } = await recordExpense(150_000);
      await api.ok(approver.token, "approve-entry", { entryId }, { expectedVersion: 1 });
      const reply = await edit(author, entryId, { amountMinor: 160_000 }, 2);
      expect(reply.status).toBe(409);
      expect(reply.body.error).toMatchObject({
        code: "INVALID_STATE_TRANSITION",
        metadata: { status: "POSTED", reason: "not_pending" },
      });
    });

    it("refuses a rejected entry", async () => {
      const { entryId } = await recordExpense(150_000);
      await api.ok(approver.token, "reject-entry", { entryId, reason: "doublon" }, { expectedVersion: 1 });
      const reply = await edit(author, entryId, { amountMinor: 160_000 }, 2);
      expect(reply.status).toBe(409);
      expect(reply.body.error?.code).toBe("INVALID_STATE_TRANSITION");
    });

    it("refuses an entry posted at capture", async () => {
      const { entryId, outcome } = await recordExpense(40_000);
      expect(outcome.recordStatus).toBe("POSTED");
      const reply = await edit(author, entryId, { amountMinor: 45_000 }, 1);
      expect(reply.status).toBe(409);
      expect(reply.body.error?.code).toBe("INVALID_STATE_TRANSITION");
    });

    it("needs the version the author was shown", async () => {
      const { entryId } = await recordExpense(150_000);
      const reply = await edit(author, entryId, { amountMinor: 160_000 });
      expect(reply.status).toBe(400);
      expect(reply.body.error?.code).toBe("EXPECTED_VERSION_REQUIRED");
    });

    it("answers VERSION_CONFLICT to a second save from the same stale form", async () => {
      const { entryId } = await recordExpense(150_000);
      await expect(edit(author, entryId, { amountMinor: 160_000 }, 1)).resolves.toMatchObject({ status: 200 });
      const reply = await edit(author, entryId, { amountMinor: 170_000 }, 1);
      expect(reply.status).toBe(409);
      expect(reply.body.error?.code).toBe("VERSION_CONFLICT");
    });
  });

  describe("the database backstop (0034)", () => {
    it("refuses changing a decided entry's amount", async () => {
      const { entryId } = await recordExpense(40_000);
      const attempt = inWorkspace(ctx.runtimeDb, workspaceId, (tx) =>
        tx.execute(sql`update financial_entries set amount_minor = 41000 where id = ${entryId}`),
      );
      await expect(attempt).rejects.toSatisfy((error: unknown) =>
        /immutable once decided/.test(String((error as { cause?: unknown }).cause ?? error)),
      );
    });

    it("refuses deleting a decided entry's line", async () => {
      const { entryId } = await recordExpense(40_000);
      const attempt = inWorkspace(ctx.runtimeDb, workspaceId, (tx) =>
        tx.execute(sql`delete from financial_postings where financial_entry_id = ${entryId}`),
      );
      await expect(attempt).rejects.toSatisfy((error: unknown) =>
        /removable only from a pending entry/.test(String((error as { cause?: unknown }).cause ?? error)),
      );
      expect(await lines(entryId)).toHaveLength(1);
    });

    it("refuses at commit a pending entry whose amount moved without its lines", async () => {
      const { entryId } = await recordExpense(150_000);
      const attempt = inWorkspace(ctx.runtimeDb, workspaceId, (tx) =>
        tx.execute(sql`update financial_entries set amount_minor = 151000 where id = ${entryId}`),
      );
      await expect(attempt).rejects.toSatisfy((error: unknown) =>
        /postings summing to 150000, not its amount 151000/.test(String((error as { cause?: unknown }).cause ?? error)),
      );
      expect((await entryRow(entryId))?.amountMinor).toBe(150_000n);
    });

    it("refuses at commit a pending entry left without lines", async () => {
      const { entryId } = await recordExpense(150_000);
      const attempt = inWorkspace(ctx.runtimeDb, workspaceId, (tx) =>
        tx.execute(sql`delete from financial_postings where financial_entry_id = ${entryId}`),
      );
      await expect(attempt).rejects.toSatisfy((error: unknown) =>
        /postings summing to 0, not its amount 150000/.test(String((error as { cause?: unknown }).cause ?? error)),
      );
      expect(await lines(entryId)).toHaveLength(1);
    });
  });
});
