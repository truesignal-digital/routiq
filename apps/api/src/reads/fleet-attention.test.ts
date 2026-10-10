import { randomUUID } from "node:crypto";
import {
  comingUpResponse,
  todoResponse,
  type ComingUpResponse,
  type TodoCode,
  type TodoResponse,
  type TodoRow,
} from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { branches } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { setModule } from "../test/vendor.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";
import { addDays } from "./business-date.js";

/** Above every recording band, so the entry waits for a decision, and inside Finance's. */
const WAITING_AMOUNT = 500_000;
const POSTED_AMOUNT = 25_000;

/**
 * The Overviews' To do and Coming up (#661): every vehicle the caller can
 * see, each row gated by its module and the roles it waits on, ranked safety
 * then money, never narrowed by the Ambient Branch.
 */
describe("GET /v1/todo and /v1/coming-up", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let ydeBranchId: string;
  let director: Actor;
  let admin: Actor;
  let ydeAdmin: Actor;
  let finance: Actor;
  let cashier: Actor;
  let technician: Actor;
  let driver: Actor;
  let dla1: string;
  let dla2: string;
  let yde1: string;
  let businessDate: string;
  let lastMonth: string;
  const ids = {
    grounding: randomUUID(),
    dla2Issue: randomUUID(),
    yde1Issue: randomUUID(),
    visite: randomUUID(),
    insurance: randomUUID(),
    carteGrise: randomUUID(),
  };

  async function todo(actor: Actor, query = ""): Promise<TodoResponse> {
    const response = await api.get(actor.token, `/v1/todo${query}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return todoResponse.parse(response.body);
  }

  async function comingUp(actor: Actor, query = ""): Promise<ComingUpResponse> {
    const response = await api.get(actor.token, `/v1/coming-up${query}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return comingUpResponse.parse(response.body);
  }

  const codes = (body: { rows: Array<{ code: string }> }) => body.rows.map((row) => row.code);
  const find = (body: TodoResponse, code: TodoCode, id?: string): TodoRow | undefined =>
    body.rows.find((row) => row.code === code && (id === undefined || row.asset?.id === id || row.link.id === id));

  async function reportIssue(issueId: string, assetId: string, safetyCritical: boolean) {
    await api.ok(driver.token, "report-issue", {
      issueId,
      assetId,
      description: safetyCritical ? "Freins qui lâchent" : "Rétroviseur cassé",
      safetyCritical,
    });
  }

  async function addDocument(documentId: string, assetId: string, documentTypeCode: string, expiresAt: string) {
    await api.ok(director.token, "add-or-renew-document", {
      documentId,
      assetId,
      documentTypeCode,
      documentNumber: `${documentTypeCode}-${documentId.slice(0, 4)}`,
      expiresAt,
    });
  }

  async function planTrip(day: string, plannedAssetId?: string) {
    await api.ok(admin.token, "plan-trip", {
      activityId: randomUUID(),
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      plannedStartAt: `${day}T08:00:00+01:00`,
      ...(plannedAssetId === undefined ? {} : { plannedAssetId }),
    });
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    const [yaounde] = await ctx.db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();
    ydeBranchId = yaounde!.id;
    director = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    ydeAdmin = await seedActor(ctx.db, { workspaceId, role: "ADMIN", branchIds: [ydeBranchId] });
    finance = await seedActor(ctx.db, { workspaceId, role: "FINANCE" });
    cashier = await seedActor(ctx.db, { workspaceId, role: "CASHIER", branchIds: [seeded.branch.id] });
    technician = await seedActor(ctx.db, { workspaceId, role: "TECHNICIAN" });
    driver = await seedActor(ctx.db, { workspaceId, role: "DRIVER" });
    await setModule(ctx.db, workspaceId, "SCHEDULING", true);

    dla1 = await seedAsset(ctx.app, director.token, { assetCode: "FT-DLA1" });
    dla2 = await seedAsset(ctx.app, director.token, { assetCode: "FT-DLA2" });
    yde1 = await seedAsset(ctx.app, director.token, { assetCode: "FT-YDE1", branchCode: "YDE" });

    businessDate = (await todo(director)).businessDate;
    const [year, month] = businessDate.split("-").map(Number) as [number, number];
    lastMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;

    // Safety: one grounded truck, a problem on each of the others, papers
    // expired, due in 6 days and in 20.
    await reportIssue(ids.grounding, dla1, true);
    await reportIssue(ids.dla2Issue, dla2, false);
    await reportIssue(ids.yde1Issue, yde1, false);
    await addDocument(ids.insurance, dla2, "INSURANCE", addDays(businessDate, -3));
    await addDocument(ids.visite, dla2, "VISITE_TECHNIQUE", addDays(businessDate, 6));
    await addDocument(ids.carteGrise, yde1, "CARTE_GRISE", addDays(businessDate, 20));

    // Money, last month: one expense waiting for a decision, one posted, both
    // without their receipt, so last month is still open with two blockers.
    const waiting = await api.ok(driver.token, "record-expense", {
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: `${lastMonth}-15`,
      amountMinor: WAITING_AMOUNT,
      paymentMethod: "CASH",
      postings: [{ assetId: dla2, amountMinor: WAITING_AMOUNT }],
    });
    expect(waiting.recordStatus).toBe("SUBMITTED");
    const posted = await api.ok(director.token, "record-expense", {
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: `${lastMonth}-16`,
      amountMinor: POSTED_AMOUNT,
      paymentMethod: "CASH",
      postings: [{ assetId: dla1, amountMinor: POSTED_AMOUNT }],
    });
    expect(posted.recordStatus).toBe("POSTED");

    // Coming up: two trips in the next 14 days (one without a truck), one later.
    await planTrip(addDays(businessDate, 2));
    await planTrip(addDays(businessDate, 3), dla2);
    await planTrip(addDays(businessDate, 20));
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("refuses the driver, who has My day instead, and keeps Coming up from the counter", async () => {
    for (const path of ["/v1/todo", "/v1/coming-up"]) {
      const response = await api.get(driver.token, path);
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: { code: "ROLE_FORBIDDEN" } });
    }
    expect((await api.get(cashier.token, "/v1/coming-up")).status).toBe(403);
    expect((await api.get(cashier.token, "/v1/todo")).status).toBe(200);
  });

  it("ranks every safety row before every money row, most severe first", async () => {
    const body = await todo(director);
    expect(codes(body)).toEqual([
      "VEHICLE_GROUNDED",
      "DOCUMENT_EXPIRED",
      "ISSUE_UNPLANNED",
      "ISSUE_UNPLANNED",
      "DOCUMENT_EXPIRING",
      "DOCUMENT_EXPIRING",
      "ENTRIES_AWAITING_APPROVAL",
      "ENTRIES_EVIDENCE_MISSING",
      "PERIOD_OPEN",
    ]);
    expect(body.rows.map((row) => row.severity)).toEqual([
      "CRITICAL",
      "CRITICAL",
      "WARNING",
      "WARNING",
      "WARNING",
      "WARNING",
      "WARNING",
      "WARNING",
      "INFO",
    ]);
    // Oldest problem first; the sooner expiry first.
    expect(body.rows.slice(2, 4).map((row) => row.asset?.assetCode)).toEqual(["FT-DLA2", "FT-YDE1"]);
    expect(body.rows.slice(4, 6).map((row) => row.asset?.assetCode)).toEqual(["FT-DLA2", "FT-YDE1"]);
    expect(body.totalCount).toBe(9);
  });

  it("links every row to its record or list, with facts and codes and no sentence", async () => {
    const body = await todo(director);
    expect(find(body, "VEHICLE_GROUNDED")).toMatchObject({
      link: { kind: "asset", id: dla1, number: "FT-DLA1" },
      asset: { id: dla1, assetCode: "FT-DLA1" },
      params: { days: 0, safetyCritical: true, workOrderPlanned: false, readyForRelease: false },
    });
    // The grounded row speaks for the problem that grounded the truck.
    expect(body.rows.some((row) => row.link.id === ids.grounding)).toBe(false);
    expect(find(body, "ISSUE_UNPLANNED", dla2)).toMatchObject({
      link: { kind: "operational_issue", id: ids.dla2Issue, number: null },
      params: { safetyCritical: false, description: "Rétroviseur cassé" },
    });
    expect(find(body, "DOCUMENT_EXPIRED")).toMatchObject({
      link: { kind: "document", id: ids.insurance },
      params: { daysLeft: -3, documentTypeLabelEn: "Insurance" },
    });
    expect(find(body, "DOCUMENT_EXPIRING", dla2)).toMatchObject({
      link: { kind: "document", id: ids.visite },
      params: { daysLeft: 6, documentTypeLabelFr: "Visite technique", expiresAt: addDays(businessDate, 6) },
    });
    expect(find(body, "DOCUMENT_EXPIRING", yde1)?.params.documentTypeLabelFr).toBe("Carte grise");
    expect(find(body, "ENTRIES_AWAITING_APPROVAL")).toMatchObject({
      link: { kind: "approvals", id: null, number: null },
      asset: null,
      params: { count: 1, amountMinor: WAITING_AMOUNT, currency: "XAF" },
    });
    expect(find(body, "ENTRIES_EVIDENCE_MISSING")).toMatchObject({
      link: { kind: "entries_evidence_missing", id: null },
      params: { count: 2, amountMinor: WAITING_AMOUNT + POSTED_AMOUNT, currency: "XAF" },
    });
    expect(find(body, "PERIOD_OPEN")).toMatchObject({
      link: { kind: "posting_period", number: lastMonth },
      params: { periodCode: lastMonth, submittedCount: 1, evidenceMissingCount: 2, olderOpenCount: 0 },
    });
    for (const row of body.rows) expect(Object.values(row.params).every((value) => typeof value !== "string" || value.length <= 140)).toBe(true);
  });

  it("gives each role only the rows that wait on it", async () => {
    const set = async (actor: Actor) => [...new Set(codes(await todo(actor)))].sort();
    expect(await set(finance)).toEqual([
      "DOCUMENT_EXPIRED",
      "DOCUMENT_EXPIRING",
      "ENTRIES_AWAITING_APPROVAL",
      "ENTRIES_EVIDENCE_MISSING",
      "PERIOD_OPEN",
      "VEHICLE_GROUNDED",
    ]);
    expect(await set(admin)).toEqual([
      "DOCUMENT_EXPIRED",
      "DOCUMENT_EXPIRING",
      "ENTRIES_EVIDENCE_MISSING",
      "ISSUE_UNPLANNED",
      "VEHICLE_GROUNDED",
    ]);
    expect(await set(technician)).toEqual(["DOCUMENT_EXPIRED", "DOCUMENT_EXPIRING", "ISSUE_UNPLANNED", "VEHICLE_GROUNDED"]);
    expect(await set(cashier)).toEqual(["ENTRIES_EVIDENCE_MISSING"]);
  });

  it("counts the whole branch scope, ignores the ambient branch and says so", async () => {
    const whole = await todo(director);
    expect(whole.scope).toEqual({ ambientBranch: "IGNORED", branchIds: "ALL" });
    expect(await todo(director, `?branchId=${ydeBranchId}`)).toEqual(whole);

    const yde = await todo(ydeAdmin);
    expect(yde.scope).toEqual({ ambientBranch: "IGNORED", branchIds: [ydeBranchId] });
    expect(yde.rows.map((row) => [row.code, row.asset?.assetCode])).toEqual([
      ["ISSUE_UNPLANNED", "FT-YDE1"],
      ["DOCUMENT_EXPIRING", "FT-YDE1"],
    ]);
    expect((await comingUp(ydeAdmin, "?days=30")).rows.map((row) => row.asset?.assetCode)).toEqual(["FT-YDE1"]);
  });

  it("shows what comes up in the next 14 or 30 days, and names what it could not count", async () => {
    const soon = await comingUp(director);
    expect(soon.windowDays).toBe(14);
    expect(soon.notCounted).toEqual(["SERVICE_DUE_BY_KM"]);
    expect(soon.scope).toEqual({ ambientBranch: "IGNORED", branchIds: "ALL" });
    expect(soon.rows).toEqual([
      {
        code: "TRIPS_PLANNED",
        link: { kind: "planning", id: null, number: null },
        asset: null,
        branchId: null,
        dueDate: addDays(businessDate, 2),
        params: { plannedCount: 2, withoutVehicleCount: 1 },
      },
      {
        code: "DOCUMENT_DUE",
        link: { kind: "document", id: ids.visite, number: expect.any(String) },
        asset: { id: dla2, assetCode: "FT-DLA2" },
        branchId: expect.any(String),
        dueDate: addDays(businessDate, 6),
        params: { documentTypeLabelFr: "Visite technique", documentTypeLabelEn: "Visite technique", daysLeft: 6 },
      },
    ]);

    const month = await comingUp(director, "?days=30");
    expect(month.windowDays).toBe(30);
    expect(month.rows.map((row) => row.code)).toEqual(["TRIPS_PLANNED", "DOCUMENT_DUE", "DOCUMENT_DUE"]);
    expect(month.rows[0]?.params).toEqual({ plannedCount: 3, withoutVehicleCount: 2 });
    expect(month.rows[2]).toMatchObject({ link: { id: ids.carteGrise }, params: { daysLeft: 20 } });
    // Expired papers are To do, never coming up.
    expect(month.rows.some((row) => row.link.id === ids.insurance)).toBe(false);

    expect((await comingUp(technician)).rows.map((row) => row.code)).toEqual(["TRIPS_PLANNED", "DOCUMENT_DUE"]);
    expect((await api.get(director.token, "/v1/coming-up?days=7")).status).toBe(400);
  });

  it("drops the rows of a module that is off, and brings them back unchanged", async () => {
    const before = { todo: await todo(director), comingUp: await comingUp(director) };

    await setModule(ctx.db, workspaceId, "MAINTENANCE", false);
    expect(codes(await todo(director))).not.toContain("VEHICLE_GROUNDED");
    expect(codes(await todo(director))).not.toContain("ISSUE_UNPLANNED");
    expect((await comingUp(director)).notCounted).toEqual([]);
    expect(codes(await todo(technician))).toEqual(["DOCUMENT_EXPIRED", "DOCUMENT_EXPIRING", "DOCUMENT_EXPIRING"]);
    await setModule(ctx.db, workspaceId, "MAINTENANCE", true);

    await setModule(ctx.db, workspaceId, "DOCUMENTS", false);
    expect(codes(await todo(director)).filter((code) => code.startsWith("DOCUMENT"))).toEqual([]);
    expect(codes(await comingUp(director))).toEqual(["TRIPS_PLANNED"]);
    await setModule(ctx.db, workspaceId, "DOCUMENTS", true);

    await setModule(ctx.db, workspaceId, "FINANCE", false);
    expect(codes(await todo(director)).filter((code) => code.startsWith("ENTRIES") || code === "PERIOD_OPEN")).toEqual([]);
    expect(codes(await todo(cashier))).toEqual([]);
    await setModule(ctx.db, workspaceId, "FINANCE", true);

    await setModule(ctx.db, workspaceId, "SCHEDULING", false);
    expect(codes(await comingUp(director))).toEqual(["DOCUMENT_DUE"]);
    await setModule(ctx.db, workspaceId, "SCHEDULING", true);

    expect(await todo(director)).toEqual(before.todo);
    expect(await comingUp(director)).toEqual(before.comingUp);
  });

  it("follows the truck page: a work order takes a problem off and plans the grounding", async () => {
    await api.ok(technician.token, "create-work-order", {
      workOrderId: randomUUID(),
      assetId: dla2,
      issueId: ids.dla2Issue,
      description: "Remplacer le rétroviseur",
      expectedCostMinor: 10_000,
    });
    await api.ok(technician.token, "create-work-order", {
      workOrderId: randomUUID(),
      assetId: dla1,
      issueId: ids.grounding,
      description: "Plaquettes",
      expectedCostMinor: 10_000,
    });
    const body = await todo(technician);
    expect(find(body, "ISSUE_UNPLANNED", dla2)).toBeUndefined();
    expect(find(body, "VEHICLE_GROUNDED")?.params.workOrderPlanned).toBe(true);
    const truckPage = await api.get(technician.token, `/v1/assets/${dla2}/attention`);
    expect((truckPage.body as { items: Array<{ code: string }> }).items.map((item) => item.code)).not.toContain(
      "ISSUE_UNPLANNED",
    );
  });
});
