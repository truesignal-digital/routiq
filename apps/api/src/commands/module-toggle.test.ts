import { randomUUID } from "node:crypto";
import { historyListResponse } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assets, auditEvents, commands, workspaceModules } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";
import { asVendor, vendorOperator } from "../test/vendor.js";
import "../server.js";

/**
 * Module flags are entitlements the vendor grants (ADR-0005, #362): a vendor
 * operator changes them for a named workspace through the platform pipeline,
 * and no tenant role can, whatever the version it sends.
 */
describe("enable-module / disable-module", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function tenant() {
    const seeded = await seedWorkspace(ctx.db);
    const director = await seedActor(ctx.db, { workspaceId: seeded.workspace.id, role: "DIRECTOR" });
    const admin = await seedActor(ctx.db, { workspaceId: seeded.workspace.id, role: "ADMIN" });
    return { id: seeded.workspace.id, slug: seeded.workspace.slug, director, admin };
  }

  function toggle(name: "enable-module" | "disable-module", workspaceSlug: string, moduleCode: string, key?: string) {
    return asVendor(ctx.db, name, 2, { workspaceSlug, moduleCode }, key);
  }

  function moduleRows(workspaceId: string) {
    return ctx.db.select().from(workspaceModules).where(eq(workspaceModules.workspaceId, workspaceId));
  }

  function registerAsset(actor: Actor) {
    return api.send(actor.token, "register-asset", {
      assetId: randomUUID(),
      assetCode: `TRK-${randomUUID().slice(0, 6)}`,
      assetClassCode: "TRUCK",
      templateCode: "TRUCKING",
      branchCode: "DLA",
    });
  }

  it("turns a module off and on for the named workspace only, keeping its records", async () => {
    const a = await tenant();
    const b = await tenant();
    const kept = await seedAsset(ctx.app, a.director.token);

    expect((await toggle("disable-module", a.slug, "ASSETS")).status).toBe(200);
    const refused = await registerAsset(a.director);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toEqual({ code: "MODULE_DISABLED", metadata: { module: "ASSETS" } });
    expect((await registerAsset(b.director)).status).toBe(200);
    expect(await moduleRows(b.id)).toEqual([]);

    // Off hides the module; it deletes nothing.
    expect(await ctx.db.select({ id: assets.id }).from(assets).where(eq(assets.id, kept))).toHaveLength(1);

    const enabled = await toggle("enable-module", a.slug, "ASSETS");
    expect(enabled.body).toMatchObject({ rowVersion: 2 });
    expect((await registerAsset(a.director)).status).toBe(200);
    expect((await moduleRows(a.id)).map((row) => [row.moduleCode, row.enabled])).toEqual([["ASSETS", true]]);
  });

  it("files a platform receipt and audit event that the tenant's history shows", async () => {
    const a = await tenant();
    const operator = await vendorOperator(ctx.db);
    const reply = await toggle("disable-module", a.slug, "FINANCE");
    expect(reply.status).toBe(200);
    const { commandId, recordId } = reply.body as { commandId: string; recordId: string };

    const [receipt] = await ctx.db.select().from(commands).where(eq(commands.id, commandId));
    expect(receipt).toMatchObject({
      scope: "PLATFORM",
      workspaceId: a.id,
      commandType: "disable-module",
      commandVersion: "2",
      initiatedByPrincipalId: operator.principalId,
    });
    const events = await ctx.db.select().from(auditEvents).where(eq(auditEvents.commandId, commandId));
    expect(events).toEqual([
      expect.objectContaining({
        scope: "PLATFORM",
        workspaceId: a.id,
        eventType: "module.disabled",
        entityType: "workspace_module",
        entityId: recordId,
        actorPrincipalId: operator.principalId,
        afterState: expect.objectContaining({ moduleCode: "FINANCE", enabled: false }),
      }),
    ]);

    const history = await api.get(a.director.token, `/v1/history/workspace_module/${recordId}`);
    expect(history.status).toBe(200);
    expect(historyListResponse.parse(history.body).items).toEqual([
      expect.objectContaining({
        eventType: "module.disabled",
        actor: { principalId: null, displayName: null, scope: "PLATFORM" },
      }),
    ]);
  });

  it("refuses every tenant role on either version and writes nothing", async () => {
    const a = await tenant();
    for (const actor of [a.director, a.admin]) {
      for (const name of ["enable-module", "disable-module"]) {
        const v1 = await api.send(actor.token, name, { moduleCode: "FINANCE" });
        const v2 = await api.send(actor.token, name, { workspaceSlug: a.slug, moduleCode: "FINANCE" }, {}, 2);
        for (const reply of [v1, v2]) {
          expect(reply.status, name).toBe(403);
          expect(reply.body.error?.code, name).toBe("COMMAND_SCOPE_FORBIDDEN");
        }
      }
    }
    expect(await moduleRows(a.id)).toEqual([]);
  });

  it("refuses a retry of a toggle a tenant made before the move instead of replaying it", async () => {
    const a = await tenant();
    const idempotencyKey = `legacy-${randomUUID()}`;
    await ctx.db.insert(commands).values({
      id: randomUUID(),
      workspaceId: a.id,
      commandType: "disable-module",
      commandVersion: "1",
      origin: "HUMAN_UI",
      status: "EXECUTED",
      initiatedByPrincipalId: a.director.principalId,
      idempotencyKey,
      payload: { moduleCode: "FINANCE" },
    });

    const retry = await api.send(a.director.token, "disable-module", { moduleCode: "FINANCE" }, { idempotencyKey });
    expect(retry.status).toBe(403);
    expect(retry.body.error?.code).toBe("COMMAND_SCOPE_FORBIDDEN");
  });

  it("replays a vendor retry under the same key and refuses the key for another change", async () => {
    const a = await tenant();
    const key = `vendor-${randomUUID()}`;
    const first = await toggle("disable-module", a.slug, "MAINTENANCE", key);
    expect(first.body).toMatchObject({ idempotentReplay: false });
    const replay = await toggle("disable-module", a.slug, "MAINTENANCE", key);
    expect(replay.body).toMatchObject({ idempotentReplay: true, recordId: (first.body as { recordId: string }).recordId });
    const other = await toggle("disable-module", a.slug, "DOCUMENTS", key);
    expect(other.status).toBe(409);
    expect((await moduleRows(a.id)).map((row) => row.moduleCode)).toEqual(["MAINTENANCE"]);
  });

  it("keeps Maintenance's records through off and on, refusing its reads and commands meanwhile", async () => {
    const a = await tenant();
    const assetId = await seedAsset(ctx.app, a.director.token);
    const issueId = randomUUID();
    const workOrderId = randomUUID();
    await api.ok(a.director.token, "report-issue", {
      issueId,
      assetId,
      description: "Frein avant qui grince",
      safetyCritical: true,
    });
    await api.ok(a.director.token, "create-work-order", {
      workOrderId,
      assetId,
      issueId,
      description: "Changer les plaquettes",
      expectedCostMinor: 0,
    });
    const reads = [`/v1/issues/${issueId}`, `/v1/work-orders/${workOrderId}`, "/v1/issues", "/v1/work-orders"];
    const before = await Promise.all(reads.map((url) => api.get(a.director.token, url)));
    expect(before.map((reply) => reply.status)).toEqual([200, 200, 200, 200]);

    expect((await toggle("disable-module", a.slug, "MAINTENANCE")).status).toBe(200);
    for (const url of reads) {
      const off = await api.get(a.director.token, url);
      expect(off, url).toEqual({ status: 403, body: { error: { code: "MODULE_DISABLED", metadata: { module: "MAINTENANCE" } } } });
    }
    const refused = await api.send(a.director.token, "report-issue", {
      issueId: randomUUID(),
      assetId,
      description: "Phare cassé",
      safetyCritical: false,
    });
    expect(refused).toMatchObject({ status: 403, body: { error: { code: "MODULE_DISABLED" } } });

    expect((await toggle("enable-module", a.slug, "MAINTENANCE")).status).toBe(200);
    const after = await Promise.all(reads.map((url) => api.get(a.director.token, url)));
    expect(after).toEqual(before);
  });

  it("keeps Trips on while Scheduling needs it, and Scheduling off until Trips is on", async () => {
    const a = await tenant();
    const state = async () =>
      new Map((await moduleRows(a.id)).map((row) => [row.moduleCode, row.enabled]));

    expect((await toggle("enable-module", a.slug, "SCHEDULING")).status).toBe(200);
    const stillRequired = await toggle("disable-module", a.slug, "ACTIVITIES");
    expect(stillRequired).toMatchObject({
      status: 409,
      body: { error: { code: "MODULE_STILL_REQUIRED", metadata: { module: "ACTIVITIES", requiredBy: ["SCHEDULING"] } } },
    });
    expect(await state()).toEqual(new Map([["SCHEDULING", true]]));

    expect((await toggle("disable-module", a.slug, "SCHEDULING")).status).toBe(200);
    expect((await toggle("disable-module", a.slug, "ACTIVITIES")).status).toBe(200);
    const dependencyOff = await toggle("enable-module", a.slug, "SCHEDULING");
    expect(dependencyOff).toMatchObject({
      status: 409,
      body: { error: { code: "MODULE_DEPENDENCY_DISABLED", metadata: { module: "SCHEDULING", requires: ["ACTIVITIES"] } } },
    });
    expect(await state()).toEqual(new Map([["SCHEDULING", false], ["ACTIVITIES", false]]));

    expect((await toggle("enable-module", a.slug, "ACTIVITIES")).status).toBe(200);
    expect((await toggle("enable-module", a.slug, "SCHEDULING")).status).toBe(200);
  });

  it("keeps CORE always on, names an unknown workspace, and points v1 at the target it lacks", async () => {
    const a = await tenant();
    const core = await toggle("disable-module", a.slug, "CORE");
    expect(core.status).toBe(400);
    expect(core.body).toMatchObject({ error: { code: "VALIDATION_FAILED" } });

    const unknown = await toggle("disable-module", `missing-${randomUUID().slice(0, 6)}`, "FINANCE");
    expect(unknown.body).toMatchObject({
      error: { code: "REFERENCE_NOT_FOUND", metadata: { referenceType: "workspace" } },
    });

    const v1 = await asVendor(ctx.db, "disable-module", 1, { moduleCode: "FINANCE" });
    expect(v1.status).toBe(400);
    expect(v1.body).toMatchObject({
      error: { code: "VALIDATION_FAILED", metadata: { issues: [{ path: ["workspaceSlug"] }] } },
    });
    expect(
      await ctx.db
        .select()
        .from(workspaceModules)
        .where(and(eq(workspaceModules.workspaceId, a.id), eq(workspaceModules.moduleCode, "FINANCE"))),
    ).toEqual([]);
  });
});
