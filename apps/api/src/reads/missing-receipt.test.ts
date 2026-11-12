import { randomUUID } from "node:crypto";
import { financeSummaryResponse, financialEntryListResponse, todoResponse } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postingPeriods, sourceArtifacts } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedWorkspace } from "../test/seed.js";
import { currentBusinessDate } from "./business-date.js";

/**
 * Every "no receipt" number equals the rows its link opens. Two windows:
 * this month by economic date (Money tile, entries chip, Dashboard sentence),
 * and everything still due (Dashboard To-do), which opens the list with no month.
 */
describe("missing receipts: each number equals the list it opens", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let director: Actor;
  let driver: Actor;
  const today = currentBusinessDate(new Date(), "Africa/Douala");
  const month = today.slice(0, 7);
  const lastMonth = (() => {
    const [year, m] = month.split("-").map(Number) as [number, number];
    const prior = new Date(Date.UTC(year, m - 2, 1));
    return `${prior.getUTCFullYear()}-${String(prior.getUTCMonth() + 1).padStart(2, "0")}`;
  })();

  const expense = async (who: Actor, amountMinor: number, opts: { economicDate?: string; withFile?: boolean } = {}) => {
    const sourceArtifactIds: string[] = [];
    if (opts.withFile) {
      const id = randomUUID();
      await ctx.db.insert(sourceArtifacts).values({
        id,
        workspaceId,
        storageKey: `ws/${workspaceId}/finalized-artifacts/${id}/x`,
        sha256: "x",
        mimeType: "application/pdf",
        sizeBytes: 10n,
        uploadedByPrincipalId: who.principalId,
      });
      sourceArtifactIds.push(id);
    }
    const entryId = randomUUID();
    await api.ok(
      who.token,
      "record-expense",
      {
        entryId,
        branchCode: "DLA",
        categoryCode: "FUEL",
        economicDate: opts.economicDate ?? today,
        amountMinor,
        paymentMethod: "CASH",
        postings: [{ amountMinor }],
      },
      { sourceArtifactIds },
    );
    return entryId;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    director = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    driver = await seedActor(ctx.db, { workspaceId, role: "DRIVER" });

    // This month: posted without and with a receipt, waiting, rejected, cancelled.
    await expense(director, 10_000);
    await expense(director, 11_000, { withFile: true });
    await expense(driver, 150_000);
    const rejected = await expense(driver, 160_000);
    await api.ok(director.token, "reject-entry", { entryId: rejected, reason: "Doublon" }, { expectedVersion: 1 });
    const cancelled = await expense(director, 12_000);
    await api.ok(
      director.token,
      "reverse-entry",
      { reversalEntryId: randomUUID(), originalEntryId: cancelled, reason: "Doublon" },
      { expectedVersion: 1 },
    );
    // Last month, posted without a receipt, then the month is locked: still due.
    await expense(director, 13_000, { economicDate: `${lastMonth}-15` });
    await ctx.db
      .update(postingPeriods)
      .set({ status: "LOCKED", lockedAt: new Date() })
      .where(and(eq(postingPeriods.workspaceId, workspaceId), eq(postingPeriods.periodCode, lastMonth)));
  });

  afterAll(async () => {
    await ctx?.close();
  });

  const read = async (url: string) => {
    const response = await api.get(director.token, url);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body;
  };
  const rows = async (query: string) =>
    financialEntryListResponse.parse(await read(`/v1/finance/entries?evidence=MISSING&limit=100${query}`)).entries.length;

  it("counts this month on the tile, the chip and the Dashboard, and everything due on the To-do", async () => {
    const summary = financeSummaryResponse.parse(await read("/v1/finance/summary"));
    const overview = (await read("/v1/finance/overview")) as { notCounted: { missingReceipt: { count: number } } };
    const todo = todoResponse.parse(await read("/v1/todo"));
    const todoRow = todo.rows.find((row) => row.code === "ENTRIES_EVIDENCE_MISSING");

    expect(summary.month).toBe(month);
    const thisMonth = await rows(`&economicMonth=${month}`);
    const allDue = await rows("");
    expect({
      tileAndChip: summary.missingReceipt.count,
      thisMonthRows: thisMonth,
      dashboardSentence: overview.notCounted.missingReceipt.count,
      todo: todoRow?.params.count,
      todoRows: allDue,
    }).toEqual({ tileAndChip: 2, thisMonthRows: 2, dashboardSentence: 2, todo: 3, todoRows: 3 });
  });
});
