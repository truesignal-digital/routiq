import { randomUUID } from "node:crypto";
import { ROLES, type Role } from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { branches, persons } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { setModule } from "../test/vendor.js";
import { plantWorkOrderRevenue, seedWorkspace } from "../test/seed.js";

/**
 * Each role reads only the money its scope allows (#264, roles-and-access.md
 * "See entries and the ledger"): the ledger for DIRECTOR, ADMIN and FINANCE,
 * the branch's entries for CASHIER, work-order costs for TECHNICIAN, and own
 * entries for DRIVER. One row per role and money read.
 */
describe("money read scope, role by read", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  const actors = {} as Record<Role, Actor>;
  let otherDriver: Actor;
  let truckId: string;
  let ydeTruckId: string;
  let tripId: string;
  let workOrderId: string;
  const entry = {
    driver: randomUUID(),
    otherDriver: randomUUID(),
    cashier: randomUUID(),
    yaounde: randomUUID(),
    workOrder: randomUUID(),
  };

  const LEDGER: readonly Role[] = ["DIRECTOR", "ADMIN", "FINANCE"];
  const NOT_LEDGER: readonly Role[] = ["CASHIER", "TECHNICIAN", "DRIVER"];

  async function expense(actor: Actor, entryId: string, amountMinor: number, posting: Record<string, unknown>, branchCode = "DLA") {
    await api.ok(actor.token, "record-expense", {
      entryId,
      branchCode,
      categoryCode: "FUEL",
      economicDate: "2026-08-12",
      amountMinor,
      paymentMethod: "CASH",
      postings: [{ ...posting, amountMinor }],
    });
  }

  async function registerTruck(branchCode: string): Promise<string> {
    const assetId = randomUUID();
    await api.ok(actors.DIRECTOR.token, "register-asset", {
      assetId,
      assetCode: `TRK-${assetId.slice(0, 6)}`,
      assetClassCode: "TRUCK",
      templateCode: "TRUCKING",
      branchCode,
      acquisitionAmountMinor: 45_000_000,
    });
    return assetId;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    await ctx.db.insert(branches).values({ workspaceId, code: "YDE", name: "Yaoundé" });
    const douala = [seeded.branch.id];
    actors.DIRECTOR = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    actors.FINANCE = await seedActor(ctx.db, { workspaceId, role: "FINANCE" });
    for (const role of ["ADMIN", "CASHIER", "TECHNICIAN", "DRIVER"] as const) {
      actors[role] = await seedActor(ctx.db, { workspaceId, role, branchIds: douala });
    }
    otherDriver = await seedActor(ctx.db, { workspaceId, role: "DRIVER", branchIds: douala });

    truckId = await registerTruck("DLA");
    ydeTruckId = await registerTruck("YDE");
    // The driver is on the crew, so the trip is theirs to read (#545, ADR-0012
    // §3); the other driver spent on it without being crewed.
    const driverPersonId = randomUUID();
    await api.ok(actors.DIRECTOR.token, "register-person", {
      personId: driverPersonId,
      displayName: "Chauffeur",
      branchCode: "DLA",
      defaultRole: "DRIVER",
    });
    await ctx.db
      .update(persons)
      .set({ membershipId: actors.DRIVER.membershipId })
      .where(eq(persons.id, driverPersonId));
    tripId = randomUUID();
    await api.ok(actors.DIRECTOR.token, "create-activity", {
      activityId: tripId,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      primarySegmentId: randomUUID(),
      primaryAssetId: truckId,
      startedAt: "2026-08-12T05:00:00Z",
      crew: [{ activityPersonId: randomUUID(), personId: driverPersonId, role: "DRIVER" }],
    });
    workOrderId = randomUUID();
    await api.ok(actors.DIRECTOR.token, "create-work-order", {
      workOrderId,
      assetId: truckId,
      description: "Embrayage",
      expectedCostMinor: 80_000,
    });

    await expense(actors.DRIVER, entry.driver, 10_000, { assetId: truckId, activityId: tripId });
    await expense(otherDriver, entry.otherDriver, 20_000, { assetId: truckId, activityId: tripId });
    await expense(actors.CASHIER, entry.cashier, 5_000, { assetId: truckId });
    await expense(actors.DIRECTOR, entry.yaounde, 7_000, { assetId: ydeTruckId }, "YDE");
    await expense(actors.TECHNICIAN, entry.workOrder, 80_000, { assetId: truckId, workOrderId });
  });

  afterAll(async () => {
    await ctx.close();
  });

  const refused = { error: { code: "ROLE_FORBIDDEN" } };
  const missing = { error: { code: "REFERENCE_NOT_FOUND" } };
  const ids = (body: unknown, key: string, idKey: string) =>
    ((body as Record<string, Array<Record<string, string>>>)[key] ?? []).map((row) => row[idKey]).sort();

  it("lists the entries each role may read", async () => {
    const douala = [entry.driver, entry.otherDriver, entry.cashier, entry.workOrder];
    const expected: Record<Role, string[] | "refused"> = {
      DIRECTOR: [...douala, entry.yaounde],
      ADMIN: douala,
      FINANCE: [...douala, entry.yaounde],
      CASHIER: douala,
      TECHNICIAN: "refused",
      DRIVER: [entry.driver],
    };
    for (const role of ROLES) {
      const response = await api.get(actors[role].token, "/v1/finance/entries?limit=100");
      const want = expected[role];
      if (want === "refused") {
        expect({ role, status: response.status, body: response.body }).toEqual({ role, status: 403, body: refused });
      } else {
        expect({ role, status: response.status, ids: ids(response.body, "entries", "id") }).toEqual({
          role,
          status: 200,
          ids: [...want].sort(),
        });
      }
    }
  });

  it("never returns another driver's entry to a driver, by id or by filter", async () => {
    const detail = await api.get(actors.DRIVER.token, `/v1/finance/entries/${entry.otherDriver}`);
    expect(detail).toEqual({ status: 404, body: missing });
    const own = await api.get(actors.DRIVER.token, `/v1/finance/entries/${entry.driver}`);
    expect(own.status).toBe(200);
    const filtered = await api.get(actors.DRIVER.token, `/v1/finance/entries?assetId=${truckId}`);
    expect(ids(filtered.body, "entries", "id")).toEqual([entry.driver]);
  });

  it("opens an entry's detail by scope", async () => {
    const cases: Array<[Role, string, number]> = [
      ["DIRECTOR", entry.yaounde, 200],
      ["ADMIN", entry.driver, 200],
      ["ADMIN", entry.yaounde, 404],
      ["FINANCE", entry.cashier, 200],
      ["CASHIER", entry.otherDriver, 200],
      ["CASHIER", entry.yaounde, 404],
      ["TECHNICIAN", entry.workOrder, 403],
      ["DRIVER", entry.cashier, 404],
    ];
    for (const [role, entryId, status] of cases) {
      const response = await api.get(actors[role].token, `/v1/finance/entries/${entryId}`);
      expect({ role, entryId, status: response.status }).toEqual({ role, entryId, status });
    }
  });

  it("keeps the approvals queue, the periods and the vehicle totals for the ledger", async () => {
    const routes = ["/v1/finance/approvals", "/v1/finance/periods", `/v1/assets/${truckId}/finance`];
    for (const route of routes) {
      for (const role of LEDGER) {
        expect({ role, route, status: (await api.get(actors[role].token, route)).status }).toEqual({ role, route, status: 200 });
      }
      for (const role of NOT_LEDGER) {
        const response = await api.get(actors[role].token, route);
        expect({ role, route, status: response.status, body: response.body }).toEqual({ role, route, status: 403, body: refused });
      }
    }
  });

  it("leaves the vehicle's money and purchase price off its detail outside the ledger (#121)", async () => {
    for (const role of ROLES) {
      const response = await api.get(actors[role].token, `/v1/assets/${truckId}`);
      expect(response.status).toBe(200);
      const body = response.body as Record<string, unknown>;
      const ledger = LEDGER.includes(role);
      expect({ role, finance: "finance" in body, price: body.acquisitionAmountMinor }).toEqual({
        role,
        finance: ledger,
        price: ledger ? 45_000_000 : null,
      });
    }
  });

  it("reads an entry's history by scope", async () => {
    const cases: Array<[Role, string, number]> = [
      ["ADMIN", entry.otherDriver, 200],
      ["CASHIER", entry.otherDriver, 200],
      ["CASHIER", entry.yaounde, 404],
      ["TECHNICIAN", entry.workOrder, 200],
      ["TECHNICIAN", entry.driver, 404],
      ["DRIVER", entry.driver, 200],
      ["DRIVER", entry.otherDriver, 404],
    ];
    for (const [role, entryId, status] of cases) {
      const response = await api.get(actors[role].token, `/v1/history/financial_entry/${entryId}`);
      expect({ role, entryId, status: response.status }).toEqual({ role, entryId, status });
    }
  });

  it("drops the purchase price from the vehicle's own history outside the ledger", async () => {
    const timeline = await api.get(actors.DIRECTOR.token, `/v1/history/asset/${truckId}`);
    const items = (timeline.body as { items: Array<{ eventId: string; eventType: string }> }).items;
    const registered = items.find((item) => item.eventType === "asset.registered");
    expect(registered).toBeDefined();
    for (const role of ROLES) {
      const diff = await api.get(actors[role].token, `/v1/history/asset/${truckId}/${registered!.eventId}`);
      expect(diff.status).toBe(200);
      const fields = (diff.body as { changes: Array<{ field: string }> }).changes.map((change) => change.field);
      expect({ role, price: fields.includes("acquisitionAmountMinor") }).toEqual({ role, price: LEDGER.includes(role) });
    }
  });

  it("shows a trip's entries by scope, and none to the workshop", async () => {
    const expected: Record<Role, string[] | null> = {
      DIRECTOR: [entry.driver, entry.otherDriver],
      ADMIN: [entry.driver, entry.otherDriver],
      FINANCE: [entry.driver, entry.otherDriver],
      CASHIER: [entry.driver, entry.otherDriver],
      TECHNICIAN: null,
      DRIVER: [entry.driver],
    };
    for (const role of ROLES) {
      const response = await api.get(actors[role].token, `/v1/activities/${tripId}`);
      expect(response.status).toBe(200);
      const rows = (response.body as { financialEntries: Array<{ entryId: string }> | null }).financialEntries;
      const want = expected[role];
      expect({ role, entries: rows === null ? null : rows.map((row) => row.entryId).sort() }).toEqual({
        role,
        entries: want === null ? null : [...want].sort(),
      });
    }
  });

  it("shows the vehicle's money events by scope", async () => {
    const douala = [entry.driver, entry.otherDriver, entry.cashier, entry.workOrder];
    const expected: Record<Role, string[]> = {
      DIRECTOR: douala,
      ADMIN: douala,
      FINANCE: douala,
      CASHIER: douala,
      TECHNICIAN: [],
      DRIVER: [entry.driver],
    };
    for (const role of ROLES) {
      const response = await api.get(actors[role].token, `/v1/assets/${truckId}/history?kind=MONEY`);
      expect(response.status).toBe(200);
      const subjects = (response.body as { items: Array<{ subject: { id: string } }> }).items.map(
        (item) => item.subject.id,
      );
      expect({ role, entries: [...new Set(subjects)].sort() }).toEqual({ role, entries: [...expected[role]].sort() });
    }
  });

  describe("work-order costs (#390)", () => {
    // Every scope but a driver's own entries: the ledger, the counter (its
    // branch's entries) and the workshop (work-order costs).
    const readsCosts = (role: Role) => role !== "DRIVER";

    it("serves a work order's amounts and cost lines by scope, null for a driver", async () => {
      for (const role of ROLES) {
        const response = await api.get(actors[role].token, `/v1/work-orders/${workOrderId}`);
        expect({ role, status: response.status }).toEqual({ role, status: 200 });
        const body = response.body as {
          expectedCostMinor: number | null;
          actualCostMinor: number | null;
          declaredCostMinor: number | null;
          costLines: Array<{ entryId: string }> | null;
          pendingCostLines: Array<{ entryId: string }> | null;
        };
        const lines =
          body.costLines === null || body.pendingCostLines === null
            ? null
            : [...body.costLines, ...body.pendingCostLines].map((line) => line.entryId);
        expect({
          role,
          expected: body.expectedCostMinor,
          costLines: body.costLines === null ? null : "list",
          pendingCostLines: body.pendingCostLines === null ? null : "list",
          lines,
        }).toEqual(
          readsCosts(role)
            ? { role, expected: 80_000, costLines: "list", pendingCostLines: "list", lines: [entry.workOrder] }
            : { role, expected: null, costLines: null, pendingCostLines: null, lines: null },
        );
        if (!readsCosts(role)) {
          expect({ role, actual: body.actualCostMinor, declared: body.declaredCostMinor }).toEqual({
            role,
            actual: null,
            declared: null,
          });
        }
      }
    });

    it("lists work orders without their amounts for a driver", async () => {
      for (const role of ROLES) {
        const response = await api.get(actors[role].token, `/v1/work-orders?assetId=${truckId}`);
        expect({ role, status: response.status }).toEqual({ role, status: 200 });
        const row = (response.body as { items: Array<{ id: string; expectedCostMinor: number | null }> }).items.find(
          (item) => item.id === workOrderId,
        );
        expect({ role, expected: row?.expectedCostMinor }).toEqual({
          role,
          expected: readsCosts(role) ? 80_000 : null,
        });
      }
    });

    it("leaves the amounts off a work order's attention item for a driver", async () => {
      for (const role of ROLES) {
        const response = await api.get(actors[role].token, `/v1/assets/${truckId}/attention`);
        expect({ role, status: response.status }).toEqual({ role, status: 200 });
        const item = (
          response.body as { items: Array<{ subject: { id: string }; params: Record<string, unknown> }> }
        ).items.find((candidate) => candidate.subject.id === workOrderId);
        expect(item).toBeDefined();
        expect({ role, amounts: "expectedCostMinor" in item!.params || "actualCostMinor" in item!.params }).toEqual({
          role,
          amounts: readsCosts(role),
        });
      }
    });

    it("drops the money changes from a work order's history for a driver", async () => {
      const timeline = await api.get(actors.DIRECTOR.token, `/v1/history/work_order/${workOrderId}`);
      const items = (timeline.body as { items: Array<{ eventId: string; eventType: string }> }).items;
      const created = items.find((item) => item.eventType === "work_order.created");
      expect(created).toBeDefined();
      for (const role of ROLES) {
        const diff = await api.get(actors[role].token, `/v1/history/work_order/${workOrderId}/${created!.eventId}`);
        expect({ role, status: diff.status }).toEqual({ role, status: 200 });
        const changes = (diff.body as { changes: Array<{ field: string; kind: string }> }).changes;
        expect({
          role,
          money: changes.some((change) => change.kind === "MONEY"),
          description: changes.some((change) => change.field === "description"),
        }).toEqual({ role, money: readsCosts(role), description: true });
      }
    });
  });

  it("gives the home figures to the ledger only", async () => {
    for (const role of ROLES) {
      const response = await api.get(actors[role].token, "/v1/dashboard");
      expect(response.status).toBe(200);
      const body = response.body as { pendingApprovals: unknown; series: unknown };
      const ledger = LEDGER.includes(role);
      expect({ role, approvals: body.pendingApprovals !== null, series: body.series !== null }).toEqual({
        role,
        approvals: ledger,
        series: ledger,
      });
    }
  });

  it("refuses the vehicle's documents to the counter", async () => {
    for (const role of ROLES) {
      const response = await api.get(actors[role].token, `/v1/assets/${truckId}/documents`);
      if (role === "CASHIER") {
        expect({ role, status: response.status, body: response.body }).toEqual({ role, status: 403, body: refused });
      } else {
        expect({ role, status: response.status }).toEqual({ role, status: 200 });
      }
    }
  });

  it("keeps revenue that names a work order out of the workshop's scope (#444)", async () => {
    const template = randomUUID();
    await api.ok(actors.DIRECTOR.token, "record-revenue", {
      entryId: template,
      branchCode: "DLA",
      categoryCode: "FREIGHT_REVENUE",
      economicDate: "2026-08-12",
      amountMinor: 30_000,
      paymentMethod: "CASH",
      postings: [{ assetId: truckId, amountMinor: 30_000 }],
    });
    const revenue = await plantWorkOrderRevenue(ctx.db, { revenueEntryId: template, workOrderId });
    const cases: Array<[Role, string, number]> = [
      ["TECHNICIAN", revenue, 404],
      ["TECHNICIAN", entry.workOrder, 200],
      ["DIRECTOR", revenue, 200],
    ];
    for (const [role, entryId, status] of cases) {
      const response = await api.get(actors[role].token, `/v1/history/financial_entry/${entryId}`);
      expect({ role, entryId, status: response.status }).toEqual({ role, entryId, status });
    }
  });

  it("gives nobody the vehicle's money or price with FINANCE off (#118)", async () => {
    await setModule(ctx.db, workspaceId, "FINANCE", false);
    try {
      for (const role of LEDGER) {
        const response = await api.get(actors[role].token, `/v1/assets/${truckId}`);
        const body = response.body as Record<string, unknown>;
        expect({ role, finance: "finance" in body, price: body.acquisitionAmountMinor }).toEqual({
          role,
          finance: false,
          price: null,
        });
      }
    } finally {
      await setModule(ctx.db, workspaceId, "FINANCE", true);
    }
  });
});
