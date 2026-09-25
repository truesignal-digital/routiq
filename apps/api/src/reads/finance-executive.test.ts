import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { financialEntryDetail, financialEntryListResponse, historyListResponse } from "@routiq/contracts";
import { createSession } from "../auth/local.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

describe("executive financial HTTP boundaries", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let executive: string;
  let branchId: string;
  const otherBranchId = randomUUID();
  const ownEntryId = randomUUID();
  const otherBranchEntryId = randomUUID();
  const otherCompanyEntryId = randomUUID();
  const historyEvents = new Map<string, string>();

  const command = (token: string, name: string, payload: object, expectedVersion?: number) => ctx.app.inject({
    method: "POST", url: `/v1/commands/${name}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { version: 1, envelope: { commandId: randomUUID(), idempotencyKey: randomUUID(), origin: "HUMAN_UI", ...(expectedVersion === undefined ? {} : { expectedVersion }) }, payload },
  });
  const read = (path: string) => ctx.app.inject({
    method: "GET", url: path, headers: { authorization: `Bearer ${executive}` },
  });
  const expense = (entryId: string, branchCode = "DLA") => ({
    entryId, branchCode, categoryCode: "FUEL", economicDate: "2026-09-04",
    amountMinor: 25000, paymentMethod: "CASH", postings: [{ amountMinor: 25000 }],
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    const own = await seedWorkspace(ctx.db);
    const other = await seedWorkspace(ctx.db);
    branchId = own.branch.id;
    const tokenFor = async (workspaceId: string, role: "ADMIN" | "EXECUTIVE_VIEWER") => {
      const member = await seedMember(ctx.db, { workspaceId, role,
        allBranches: role === "ADMIN", branchIds: role === "ADMIN" ? [] : [branchId] });
      return (await createSession(ctx.db, { principalId: member.principal.id, workspaceId })).token;
    };
    const admin = await tokenFor(own.workspace.id, "ADMIN");
    const otherAdmin = await tokenFor(other.workspace.id, "ADMIN");
    executive = await tokenFor(own.workspace.id, "EXECUTIVE_VIEWER");
    const branch = await command(admin, "create-branch", { branchId: otherBranchId, code: "YDE", name: "Yaoundé" });
    expect(branch.statusCode, branch.body).toBe(200);
    for (const [token, id, code] of [[admin, ownEntryId, "DLA"], [admin, otherBranchEntryId, "YDE"], [otherAdmin, otherCompanyEntryId, "DLA"]]) {
      const response = await command(token!, "record-expense", expense(id!, code!));
      expect(response.statusCode, response.body).toBe(200);
      const history = await ctx.app.inject({ method: "GET", url: `/v1/history/financial_entry/${id}`,
        headers: { authorization: `Bearer ${token}` } });
      historyEvents.set(id!, historyListResponse.parse(history.json()).items[0]!.eventId);
    }
  });

  afterAll(async () => { await ctx?.close(); });

  it("reads only the actor's company and branch, including period and detail/history links", async () => {
    const response = await read("/v1/finance/entries");
    expect(response.statusCode).toBe(200);
    const list = financialEntryListResponse.parse(response.json());
    expect(list.entries.map((item) => item.id)).toEqual([ownEntryId]);
    const detailResponse = await read(`/v1/finance/entries/${ownEntryId}`);
    expect(detailResponse.statusCode).toBe(200);
    const detail = financialEntryDetail.parse(detailResponse.json());
    expect(detail.branchId).toBe(branchId);
    expect(detail.amountMinor).toBe(25000);
    expect(detail.postingPeriodCode).toBe("2026-09");
    const scoped = await read(`/v1/finance/entries?branchId=${branchId}&periodCode=2026-09`);
    expect(financialEntryListResponse.parse(scoped.json()).entries.map((item) => item.id)).toEqual([ownEntryId]);
    const otherPeriod = await read(`/v1/finance/entries?periodCode=2026-08`);
    expect(financialEntryListResponse.parse(otherPeriod.json()).entries).toEqual([]);
    const history = await read(`/v1/history/financial_entry/${ownEntryId}`);
    expect(history.statusCode).toBe(200);
    expect(historyListResponse.parse(history.json()).items.length).toBeGreaterThan(0);
    expect((await read(`/v1/history/financial_entry/${ownEntryId}/${historyEvents.get(ownEntryId)}`)).statusCode).toBe(200);
  });

  it("cannot widen branch scope with a query or open another branch/company record", async () => {
    const response = await read(`/v1/finance/entries?branchId=${otherBranchId}`);
    expect(response.statusCode).toBe(200);
    expect(financialEntryListResponse.parse(response.json()).entries).toEqual([]);
    for (const id of [otherBranchEntryId, otherCompanyEntryId]) {
      expect((await read(`/v1/finance/entries/${id}`)).statusCode).toBe(404);
      expect((await read(`/v1/history/financial_entry/${id}`)).statusCode).toBe(404);
      expect((await read(`/v1/history/financial_entry/${id}/${historyEvents.get(id)}`)).statusCode).toBe(404);
    }
  });

  it.each([
    ["record-expense", expense(randomUUID())],
    ["record-revenue", { ...expense(randomUUID()), categoryCode: "FREIGHT_REVENUE" }],
    ["approve-entry", { entryId: ownEntryId }],
    ["reject-entry", { entryId: ownEntryId, reason: "Not authorized" }],
    ["reverse-entry", { originalEntryId: ownEntryId, reversalEntryId: randomUUID(), reason: "Not authorized" }],
    ["lock-period", { periodCode: "2026-09" }],
    ["reopen-period", { periodCode: "2026-09", reason: "Not authorized" }],
  ])("denies the %s command without changing the ledger", async (name, payload) => {
    const response = await command(executive, name, payload);
    expect(response.statusCode, response.body).toBe(403);
    expect(response.json().error.code).toBe("ROLE_FORBIDDEN");
    const list = await read("/v1/finance/entries");
    expect(financialEntryListResponse.parse(list.json()).entries.map((item) => ({ id: item.id, status: item.status, amount: item.amountMinor })))
      .toEqual([{ id: ownEntryId, status: "POSTED", amount: 25000 }]);
  });

  it("drills through a total to its direction and both signed sides of a reversal", async () => {
    const seeded = await seedWorkspace(ctx.db);
    const member = await seedMember(ctx.db, { workspaceId: seeded.workspace.id, role: "ADMIN", allBranches: true });
    const admin = (await createSession(ctx.db, { principalId: member.principal.id, workspaceId: seeded.workspace.id })).token;
    const viewer = await seedMember(ctx.db, { workspaceId: seeded.workspace.id, role: "EXECUTIVE_VIEWER", branchIds: [seeded.branch.id] });
    const token = (await createSession(ctx.db, { principalId: viewer.principal.id, workspaceId: seeded.workspace.id })).token;
    const get = (path: string) => ctx.app.inject({ method: "GET", url: path, headers: { authorization: `Bearer ${token}` } });
    const originalId = randomUUID();
    const retainedId = randomUUID();
    const reversalId = randomUUID();
    for (const [name, payload] of [
      ["record-expense", expense(originalId)],
      ["record-expense", expense(retainedId)],
      ["record-revenue", { ...expense(randomUUID()), categoryCode: "FREIGHT_REVENUE" }],
      ["reverse-entry", { originalEntryId: originalId, reversalEntryId: reversalId, reason: "Duplicate fuel receipt" }],
    ] as const) {
      const response = await command(admin, name, payload, name === "reverse-entry" ? 1 : undefined);
      expect(response.statusCode, response.body).toBe(200);
    }
    const response = await get(`/v1/finance/entries?branchId=${seeded.branch.id}&periodCode=2026-09&direction=EXPENSE&status=LEDGER`);
    expect(response.statusCode, response.body).toBe(200);
    const entries = financialEntryListResponse.parse(response.json()).entries;
    expect(entries.map((item) => item.id).sort()).toEqual([originalId, retainedId, reversalId].sort());
    expect(entries.find((item) => item.id === originalId)?.status).toBe("REVERSED");
    expect(entries.find((item) => item.id === reversalId)?.amountMinor).toBe(-25000);
    const dashboard = await get(`/v1/dashboard?branchId=${seeded.branch.id}`);
    expect(entries.reduce((total, item) => total + item.amountMinor, 0)).toBe(dashboard.json().openPeriod.postedExpenseMinor);
    expect((await get("/v1/finance/entries?direction=INVALID")).statusCode).toBe(400);
  });
});
