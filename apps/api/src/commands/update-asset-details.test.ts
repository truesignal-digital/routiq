import { randomUUID } from "node:crypto";
import { vehicleHistoryResponse } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assets, auditEvents, branches } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";
import { setModule } from "../test/vendor.js";

describe("update-asset-details.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let admin: Actor;
  let boris: Actor;
  let mechanic: Actor;
  let driver: Actor;
  let approver: Actor;
  let director: Actor;
  let cashier: Actor;
  let ydeOnly: Actor;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    const workspaceId = seeded.workspace.id;
    const [yaounde] = await ctx.db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();
    if (!yaounde) throw new Error("branch insert returned no row");

    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    boris = await seedActor(ctx.db, { workspaceId, role: "ADMIN", displayName: "Boris" });
    mechanic = await seedActor(ctx.db, { workspaceId, role: "TECHNICIAN", displayName: "Hervé" });
    driver = await seedActor(ctx.db, { workspaceId, role: "DRIVER" });
    approver = await seedActor(ctx.db, { workspaceId, role: "FINANCE" });
    director = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR", displayName: "Amadou" });
    cashier = await seedActor(ctx.db, { workspaceId, role: "CASHIER" });
    ydeOnly = await seedActor(ctx.db, { workspaceId, role: "ADMIN", branchIds: [yaounde.id] });
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function truck(values: Partial<typeof assets.$inferInsert> = {}) {
    const id = await seedAsset(ctx.app, admin.token);
    if (Object.keys(values).length > 0) {
      await ctx.db.update(assets).set(values).where(eq(assets.id, id));
    }
    return id;
  }

  async function row(id: string) {
    const [found] = await ctx.db.select().from(assets).where(eq(assets.id, id));
    if (!found) throw new Error("asset missing");
    return found;
  }

  async function edit(actor: Actor, assetId: string, changes: Record<string, unknown>, version?: number) {
    const expectedVersion = version ?? (await row(assetId)).rowVersion;
    return api.send(actor.token, "update-asset-details", { assetId, ...changes }, { expectedVersion });
  }

  async function detailEvents(assetId: string) {
    return ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, assetId), eq(auditEvents.eventType, "asset.details_updated")));
  }

  it("edits the plate in place and audits the before and after", async () => {
    const id = await truck({ registrationNumber: "LT 123 AB", manufacturer: "Mercedes-Benz" });
    const reply = await edit(boris, id, { registrationNumber: "LT 132 AB" }, 1);
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ recordId: id, rowVersion: 2 });

    const after = await row(id);
    expect(after).toMatchObject({ registrationNumber: "LT 132 AB", manufacturer: "Mercedes-Benz", rowVersion: 2 });

    const [event] = await detailEvents(id);
    expect(event).toMatchObject({
      entityType: "asset",
      commandId: reply.body.commandId,
      actorPrincipalId: boris.principalId,
      beforeState: expect.objectContaining({ registrationNumber: "LT 123 AB", rowVersion: 1 }),
      afterState: expect.objectContaining({ registrationNumber: "LT 132 AB", rowVersion: 2 }),
      changedFields: ["registrationNumber", "rowVersion"],
    });
  });

  it("shows the change in the vehicle's History with the editor's name", async () => {
    const id = await truck({ registrationNumber: "LT 223 AB" });
    expect((await edit(boris, id, { registrationNumber: "LT 232 AB", modelYear: 2019 })).status).toBe(200);

    const history = await api.get(mechanic.token, `/v1/assets/${id}/history`);
    expect(history.status).toBe(200);
    const [item] = vehicleHistoryResponse
      .parse(history.body)
      .items.filter((entry) => entry.eventType === "asset.details_updated");
    expect(item).toMatchObject({
      kind: "LIFECYCLE",
      actor: { displayName: "Boris" },
      changes: [
        { field: "registrationNumber", kind: "VALUE", before: "LT 223 AB", after: "LT 232 AB" },
        { field: "modelYear", kind: "VALUE", before: null, after: 2019 },
      ],
    });
  });

  it("keeps the acquisition amount's change from the workshop, and shows it to finance readers", async () => {
    const id = await truck({ acquisitionDate: "2024-03-01" });
    expect((await edit(boris, id, { acquisitionAmountMinor: 45_000_000 })).status).toBe(200);

    const changesFor = async (actor: Actor) => {
      const history = await api.get(actor.token, `/v1/assets/${id}/history`);
      return vehicleHistoryResponse
        .parse(history.body)
        .items.find((entry) => entry.eventType === "asset.details_updated")?.changes;
    };
    expect(await changesFor(mechanic)).toEqual([]);
    expect(await changesFor(approver)).toEqual([
      { field: "acquisitionAmountMinor", kind: "MONEY", before: null, after: 45_000_000 },
    ]);
    expect(await changesFor(director)).toEqual([
      { field: "acquisitionAmountMinor", kind: "MONEY", before: null, after: 45_000_000 },
    ]);
  });

  it("is DIRECTOR's and ADMIN's only", async () => {
    const id = await truck();
    expect((await edit(director, id, { manufacturer: "MAN" })).status).toBe(200);
    expect((await edit(admin, id, { manufacturer: "DAF" })).status).toBe(200);
    for (const actor of [mechanic, driver, approver, cashier]) {
      const reply = await edit(actor, id, { manufacturer: "Renault" });
      expect(reply.status).toBe(403);
      expect(reply.body.error?.code).toBe("ROLE_FORBIDDEN");
    }
    expect((await row(id)).manufacturer).toBe("DAF");
  });

  it("refuses a vehicle outside the editor's branches", async () => {
    const id = await truck();
    const reply = await edit(ydeOnly, id, { manufacturer: "Volvo" });
    expect(reply.status).toBe(403);
    expect(reply.body.error?.code).toBe("ROLE_FORBIDDEN");
  });

  it("gives the second of two editors a conflict and overwrites nothing", async () => {
    const id = await truck({ registrationNumber: "LT 482 AB" });
    expect((await edit(boris, id, { registrationNumber: "LT 483 AB" }, 1)).status).toBe(200);
    const late = await edit(admin, id, { registrationNumber: "LT 999 ZZ" }, 1);
    expect(late.status).toBe(409);
    expect(late.body.error).toMatchObject({
      code: "VERSION_CONFLICT",
      metadata: { expectedVersion: 1, currentVersion: 2 },
    });
    expect(await row(id)).toMatchObject({ registrationNumber: "LT 483 AB", rowVersion: 2 });
    expect(await detailEvents(id)).toHaveLength(1);
  });

  it("requires the version the edit was made from", async () => {
    const id = await truck();
    const reply = await api.send(boris.token, "update-asset-details", { assetId: id, model: "Actros" });
    expect(reply.status).toBe(400);
    expect(reply.body.error?.code).toBe("EXPECTED_VERSION_REQUIRED");
  });

  it.each(["SOLD", "RETIRED", "WRITTEN_OFF"] as const)("refuses a %s vehicle", async (status) => {
    const id = await truck({ lifecycleStatus: status });
    const reply = await edit(admin, id, { model: "Actros" });
    expect(reply.status).toBe(409);
    expect(reply.body.error).toMatchObject({
      code: "ASSET_NOT_OPERATIONAL",
      metadata: { assetId: id, lifecycleStatus: status },
    });
  });

  it("validates specifications against the template's field list", async () => {
    const id = await truck({ customValues: { axleCount: 3, bodyType: "Tautliner" } });

    const unknown = await edit(boris, id, { customValues: { seatCount: 70 } });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatchObject({
      code: "TEMPLATE_FIELD_INVALID",
      metadata: { unknownKeys: ["seatCount"] },
    });

    const wrongType = await edit(boris, id, { customValues: { axleCount: "three" } });
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error).toMatchObject({
      code: "TEMPLATE_FIELD_INVALID",
      metadata: { wrongType: [{ key: "axleCount", expected: "number", got: "string" }] },
    });

    // A patch: the untouched key stays, null clears.
    const patched = await edit(boris, id, { customValues: { tonnageCapacity: 26, bodyType: null } });
    expect(patched.status).toBe(200);
    expect((await row(id)).customValues).toEqual({ axleCount: 3, tonnageCapacity: 26 });
  });

  it("refuses a plate another vehicle already carries, however it is spaced", async () => {
    await truck({ registrationNumber: "CE 777 AA" });
    const id = await truck({ registrationNumber: "CE 100 AA" });
    const reply = await edit(boris, id, { registrationNumber: "ce777aa" });
    expect(reply.status).toBe(409);
    expect(reply.body.error?.code).toBe("DUPLICATE_REGISTRATION_NUMBER");
    expect((await row(id)).registrationNumber).toBe("CE 100 AA");
  });

  it("lets a vehicle keep a plate it already shares, sent back as it is or re-spaced (#122)", async () => {
    // register-asset v1 never checked, so two vehicles may already carry one plate.
    await truck({ registrationNumber: "CE 888 AA" });
    const id = await truck({ registrationNumber: "CE 888 AA" });
    const same = await edit(boris, id, { registrationNumber: "CE 888 AA", model: "Actros" });
    expect(same.status).toBe(200);
    const respaced = await edit(boris, id, { registrationNumber: "ce-888-aa" });
    expect(respaced.status).toBe(200);
    expect((await row(id)).registrationNumber).toBe("ce-888-aa");
  });

  it("refuses an acquisition date in the future, and an amount without a date", async () => {
    const id = await truck();
    const future = await edit(boris, id, { acquisitionDate: "2999-01-01" });
    expect(future.status).toBe(400);
    expect(future.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      metadata: { issues: [{ path: ["acquisitionDate"], reason: "IN_FUTURE" }] },
    });

    const orphan = await edit(boris, id, { acquisitionAmountMinor: 12_000_000 });
    expect(orphan.status).toBe(400);
    expect(orphan.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      metadata: { issues: [{ path: ["acquisitionDate"], reason: "REQUIRED_WITH_AMOUNT" }] },
    });

    const both = await edit(boris, id, { acquisitionDate: "2024-03-01", acquisitionAmountMinor: 12_000_000 });
    expect(both.status).toBe(200);
    expect(await row(id)).toMatchObject({ acquisitionDate: "2024-03-01", acquisitionAmountMinor: 12_000_000n });
  });

  it("clears a field with null and writes nothing when nothing changes", async () => {
    const id = await truck({ chassisNumber: "WDB9634031L123456", model: "Actros" });
    const cleared = await edit(boris, id, { chassisNumber: null });
    expect(cleared.status).toBe(200);
    expect((await row(id)).chassisNumber).toBeNull();

    const assetTrail = await ctx.db.select().from(auditEvents).where(eq(auditEvents.entityId, id));
    const same = await edit(boris, id, { model: "Actros" });
    expect(same.status).toBe(200);
    expect(same.body.rowVersion).toBe(2);
    expect(await detailEvents(id)).toHaveLength(1);
    // The no-op is audited on its own command (#153), not on the asset's history.
    expect(await ctx.db.select().from(auditEvents).where(eq(auditEvents.entityId, id))).toHaveLength(assetTrail.length);
    const noOpCommandId = same.body.commandId ?? "";
    const noOp = await ctx.db.select().from(auditEvents).where(eq(auditEvents.commandId, noOpCommandId));
    expect(noOp).toEqual([
      expect.objectContaining({
        eventType: "command.no_change",
        entityType: "command",
        entityId: noOpCommandId,
        afterState: { assetId: id, rowVersion: 2 },
      }),
    ]);
  });

  it("takes the acquisition amount only where the books are kept", async () => {
    const other = await seedWorkspace(ctx.db);
    const otherAdmin = await seedActor(ctx.db, { workspaceId: other.workspace.id, role: "DIRECTOR" });
    const id = await seedAsset(ctx.app, otherAdmin.token);
    await ctx.db.update(assets).set({ acquisitionDate: "2024-03-01" }).where(eq(assets.id, id));
    await setModule(ctx.db, other.workspace.id, "FINANCE", false);

    const money = await edit(otherAdmin, id, { acquisitionAmountMinor: 30_000_000 });
    expect(money.status).toBe(403);
    expect(money.body.error).toMatchObject({
      code: "MODULE_DISABLED",
      metadata: { module: "FINANCE", field: "acquisitionAmountMinor" },
    });
    // The rest of the card still saves.
    expect((await edit(otherAdmin, id, { model: "Axor" })).status).toBe(200);
  });

  it("replays an exact retry once", async () => {
    const id = await truck();
    const envelope = { commandId: randomUUID(), idempotencyKey: `edit-${randomUUID()}`, expectedVersion: 1 };
    const payload = { assetId: id, manufacturer: "Scania" };
    const first = await api.send(boris.token, "update-asset-details", payload, envelope);
    const retry = await api.send(boris.token, "update-asset-details", payload, envelope);
    expect(first.status).toBe(200);
    expect(retry.body).toMatchObject({ recordId: id, rowVersion: 2, idempotentReplay: true });
    expect(await detailEvents(id)).toHaveLength(1);
  });
});
