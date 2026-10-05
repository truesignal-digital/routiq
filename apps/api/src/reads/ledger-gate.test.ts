import { randomUUID } from "node:crypto";
import { LEDGER_READER_ROLES } from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

/**
 * Review P2: the books are for the roles that read them (LEDGER_READER_ROLES).
 * The workshop sees the cost lines of its own work orders on the work-order
 * reads, never the ledger — not through the finance routes, and not through
 * the money block of the vehicle header.
 */
describe("ledger reads are for the ledger readers", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let admin: Actor;
  let mechanic: Actor;
  let assetId: string;
  let entryId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    const workspaceId = seeded.workspace.id;
    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    mechanic = await seedActor(ctx.db, { workspaceId, role: "TECHNICIAN" });
    assetId = await seedAsset(ctx.app, admin.token);
    entryId = randomUUID();
    await api.ok(admin.token, "record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-08-12",
      amountMinor: 30_000,
      paymentMethod: "CASH",
      postings: [{ assetId, amountMinor: 30_000 }],
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  const ledgerRoutes = () => [
    `/v1/finance/entries?assetId=${assetId}`,
    `/v1/finance/entries/${entryId}`,
    "/v1/finance/approvals",
  ];

  it("refuses the workshop every ledger route", async () => {
    for (const route of ledgerRoutes()) {
      const response = await api.get(mechanic.token, route);
      expect(response.status, route).toBe(403);
      expect(response.body, route).toEqual({ error: { code: "ROLE_FORBIDDEN" } });
    }
  });

  it("still serves them to every ledger-reading role", async () => {
    const workspaceId = (await seedWorkspace(ctx.db)).workspace.id;
    for (const role of LEDGER_READER_ROLES) {
      const reader = await seedActor(ctx.db, { workspaceId, role });
      for (const route of ["/v1/finance/entries", "/v1/finance/approvals"]) {
        expect((await api.get(reader.token, route)).status, `${role} ${route}`).toBe(200);
      }
    }
    expect((await api.get(admin.token, `/v1/finance/entries/${entryId}`)).status).toBe(200);
  });

  it("answers MODULE_DISABLED once FINANCE is off", async () => {
    const gated = await seedWorkspace(ctx.db);
    const gatedAdmin = await seedActor(ctx.db, { workspaceId: gated.workspace.id, role: "DIRECTOR" });
    await api.ok(gatedAdmin.token, "disable-module", { moduleCode: "FINANCE" });
    for (const route of ["/v1/finance/entries", `/v1/finance/entries/${randomUUID()}`, "/v1/finance/approvals"]) {
      const response = await api.get(gatedAdmin.token, route);
      expect(response.status, route).toBe(403);
      expect(response.body, route).toEqual({
        error: { code: "MODULE_DISABLED", metadata: { module: "FINANCE" } },
      });
    }
  });

  it("leaves the money block off the vehicle header for the workshop", async () => {
    const forMechanic = await api.get(mechanic.token, `/v1/assets/${assetId}`);
    expect(forMechanic.status).toBe(200);
    expect(forMechanic.body).not.toHaveProperty("finance");

    const forAdmin = await api.get(admin.token, `/v1/assets/${assetId}`);
    expect(forAdmin.body).toMatchObject({
      finance: { currency: "XAF", expenseMinor: 30_000, netMinor: -30_000 },
    });
  });
});
