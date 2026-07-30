import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveOperatorContext } from "../auth/context.js";
import { createSession, loginWithPin } from "../auth/local.js";
import type { OperatorContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import { platformDb, type PlatformDb } from "../db/platform.js";
import { principals, workspaceTemplates } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import { buildServer } from "../server.js";
import { dispatchCommand } from "./dispatcher.js";

/**
 * ADR-0004's server side: a workspace enables a SET of presets, and a command
 * carrying a preset outside that set is refused in the pipeline — the same place
 * module flags are checked, so no handler re-implements it.
 */
describe("template preset enforcement", () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let platform: PlatformDb;
  let operator: OperatorContext;

  beforeAll(async () => {
    testApp = await createTestApp();
    db = testApp.db;
    platform = platformDb(db);

    const [row] = await db
      .insert(principals)
      .values({ principalType: "VENDOR_OPERATOR", displayName: "vendor-cli" })
      .returning();
    if (!row) throw new Error("operator principal insert returned no row");
    const resolved = await resolveOperatorContext(db, row.id);
    if (!resolved) throw new Error("operator context did not resolve");
    operator = resolved;
  });

  afterAll(async () => {
    await testApp.close();
  });

  /** A real provisioned tenant, so the enabled set comes from the command that owns it. */
  async function provisionTenant(enabledPresets: string[]) {
    const slug = `tenant-${randomUUID().slice(0, 8)}`;
    const workspaceId = randomUUID();
    const pin = "482913";
    const username = `admin-${slug}`;

    const result = await dispatchCommand(platform, operator, {
      name: "provision-workspace",
      version: 1,
      envelope: {
        commandId: randomUUID(),
        idempotencyKey: `idem-${randomUUID()}`,
        origin: "API",
      },
      payload: {
        workspace: { id: workspaceId, slug, name: `Transports ${slug}` },
        branch: { id: randomUUID(), code: "DLA", name: "Douala" },
        admin: { id: randomUUID(), displayName: "Awa Ndongo", username, pin },
        enabledPresets,
      },
    });
    if (result.status !== 200) {
      throw new Error(`provisioning failed: ${JSON.stringify(result.body)}`);
    }

    const login = await loginWithPin(db, { workspaceSlug: slug, username, pin });
    if (!login.ok) throw new Error("provisioned admin could not log in");
    return { workspaceId, slug, token: login.session.token };
  }

  function post(token: string, name: string, payload: object) {
    return testApp.app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name,
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload,
      },
    });
  }

  function assetPayload(templateCode: string) {
    const passenger = templateCode === "PASSENGER_TRANSPORT";
    return {
      assetId: randomUUID(),
      assetCode: `ASSET-${randomUUID().slice(0, 8)}`,
      assetClassCode: passenger ? "BUS" : "TRUCK",
      templateCode,
      branchCode: "DLA",
      // seatCount is required for the passenger template (§3.3 field lists).
      customValues: passenger ? { seatCount: 52 } : {},
    };
  }

  it("accepts a command whose preset the workspace enabled", async () => {
    const tenant = await provisionTenant(["TRUCKING"]);

    const response = await post(tenant.token, "register-asset", assetPayload("TRUCKING"));

    expect(response.statusCode).toBe(200);
  });

  it("refuses a command whose preset the workspace did not enable", async () => {
    const tenant = await provisionTenant(["TRUCKING"]);

    const response = await post(
      tenant.token,
      "register-asset",
      assetPayload("PASSENGER_TRANSPORT"),
    );

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: { code: "PRESET_DISABLED", metadata: { presetCode: "PASSENGER_TRANSPORT" } },
    });
  });

  it("refuses create-activity for a preset outside the set", async () => {
    const tenant = await provisionTenant(["PASSENGER_TRANSPORT"]);
    const asset = assetPayload("PASSENGER_TRANSPORT");
    expect((await post(tenant.token, "register-asset", asset)).statusCode).toBe(200);

    const response = await post(tenant.token, "create-activity", {
      activityId: randomUUID(),
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      primarySegmentId: randomUUID(),
      primaryAssetId: asset.assetId,
      startedAt: "2026-07-30T08:00:00+01:00",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatchObject({
      code: "PRESET_DISABLED",
      metadata: { presetCode: "TRUCKING" },
    });
  });

  /**
   * The sheets carry no templateCode in their payload — the command IS the
   * preset — so this is the case a payload-only check would have missed.
   */
  it("refuses the sheet of a preset the workspace did not enable", async () => {
    const tenant = await provisionTenant(["TRUCKING"]);
    const asset = assetPayload("TRUCKING");
    expect((await post(tenant.token, "register-asset", asset)).statusCode).toBe(200);

    const response = await post(tenant.token, "record-journey-sheet", {
      activityId: randomUUID(),
      branchCode: "DLA",
      activityTypeCode: "SCHEDULED_JOURNEY",
      primarySegmentId: randomUUID(),
      primaryAssetId: asset.assetId,
      startedAt: "2026-07-30T06:00:00+01:00",
      endedAt: "2026-07-30T12:00:00+01:00",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatchObject({
      code: "PRESET_DISABLED",
      metadata: { presetCode: "PASSENGER_TRANSPORT" },
    });

    // The trucking sheet on the same workspace is the control.
    const allowed = await post(tenant.token, "record-haulage-job-sheet", {
      activityId: randomUUID(),
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      primarySegmentId: randomUUID(),
      primaryAssetId: asset.assetId,
      startedAt: "2026-07-30T06:00:00+01:00",
      endedAt: "2026-07-30T12:00:00+01:00",
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("refuses a preset whose row was explicitly disabled", async () => {
    const tenant = await provisionTenant(["TRUCKING", "PASSENGER_TRANSPORT"]);
    await db
      .update(workspaceTemplates)
      .set({ enabled: false })
      .where(
        and(
          eq(workspaceTemplates.workspaceId, tenant.workspaceId),
          eq(workspaceTemplates.presetCode, "TRUCKING"),
        ),
      );

    const response = await post(tenant.token, "register-asset", assetPayload("TRUCKING"));

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("PRESET_DISABLED");
    // The preset still enabled on the same workspace is unaffected.
    expect(
      (await post(tenant.token, "register-asset", assetPayload("PASSENGER_TRANSPORT")))
        .statusCode,
    ).toBe(200);
  });

  /**
   * Both pilot tenants and every existing test seed predate provisioning and
   * have zero workspace_templates rows. Enforcing against them would have meant
   * a data migration to ship this; instead they are grandfathered as
   * all-enabled, which is also why the rest of the suite still passes.
   */
  it("grandfathers a workspace that has no preset rows at all", async () => {
    const seeded = await seedWorkspace(db);
    const member = await seedMember(db, {
      workspaceId: seeded.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    const session = await createSession(db, {
      principalId: member.principal.id,
      workspaceId: seeded.workspace.id,
    });

    expect(
      await db
        .select()
        .from(workspaceTemplates)
        .where(eq(workspaceTemplates.workspaceId, seeded.workspace.id)),
    ).toEqual([]);

    for (const templateCode of ["TRUCKING", "PASSENGER_TRANSPORT"]) {
      const response = await post(session.token, "register-asset", assetPayload(templateCode));
      expect(response.statusCode).toBe(200);
    }
  });

  /**
   * Grandfathering is meant to be temporary, so it has to be visible: without
   * this line nobody would know which workspaces still need preset rows before
   * UNCONFIGURED can be deleted.
   */
  it("logs the workspaces still running unenforced", async () => {
    const seeded = await seedWorkspace(db);
    const member = await seedMember(db, {
      workspaceId: seeded.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    const session = await createSession(db, {
      principalId: member.principal.id,
      workspaceId: seeded.workspace.id,
    });

    const lines: string[] = [];
    const logApp = buildServer({
      db: testApp.runtimeDb,
      authDb: db,
      logger: {
        level: "info",
        stream: {
          write(line: string) {
            lines.push(line);
          },
        },
      },
    });
    await logApp.ready();

    const response = await logApp.inject({
      method: "POST",
      url: "/v1/commands",
      headers: { authorization: `Bearer ${session.token}` },
      payload: {
        name: "register-asset",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: assetPayload("TRUCKING"),
      },
    });
    expect(response.statusCode).toBe(200);
    await logApp.close();

    const warned = lines
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .filter((entry) => entry["event"] === "preset.unenforced");

    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatchObject({
      workspaceId: seeded.workspace.id,
      presetCode: "TRUCKING",
    });
  });
});
