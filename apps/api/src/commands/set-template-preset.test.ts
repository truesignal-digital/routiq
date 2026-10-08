import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveOperatorContext } from "../auth/context.js";
import { createSession, loginWithPin } from "../auth/local.js";
import type { OperatorContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import { platformDb, type PlatformDb } from "../db/platform.js";
import { auditEvents, principals, workspaceTemplates } from "../db/schema.js";
import { inWorkspace } from "../db/tenant.js";
import { enabledPresets, presetEnablement } from "../templates/registry.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import { dispatchCommand } from "./dispatcher.js";
import "../server.js";

/**
 * The writer `workspace_templates` was missing: enforcement shipped with a
 * grandfather clause for workspaces that predate provisioning, and nothing could
 * move a workspace out of it. This is that command.
 */
describe("set-template-preset.v1", () => {
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

  /** A seeded workspace has no workspace_templates rows: the grandfather case. */
  async function grandfatheredTenant() {
    const seeded = await seedWorkspace(db);
    const workspaceId = seeded.workspace.id;
    const admin = await seedMember(db, { workspaceId, role: "DIRECTOR", allBranches: true });
    const session = await createSession(db, {
      principalId: admin.principal.id,
      workspaceId,
    });
    return { workspaceId, token: session.token };
  }

  /** A real provisioned tenant, whose enabled set came from the command that owns it. */
  async function provisionedTenant(presets: string[]) {
    const slug = `tenant-${randomUUID().slice(0, 8)}`;
    const workspaceId = randomUUID();
    const username = `admin-${slug}`;
    const pin = "482913";

    const result = await dispatchCommand(platform, operator, {
      name: "provision-workspace",
      version: 2,
      envelope: {
        commandId: randomUUID(),
        idempotencyKey: `idem-${randomUUID()}`,
        origin: "API",
      },
      payload: {
        workspace: { id: workspaceId, slug, name: `Transports ${slug}` },
        branches: [{ id: randomUUID(), code: "DLA", name: "Douala" }],
        admin: { id: randomUUID(), displayName: "Awa Ndongo", username, pin },
        enabledPresets: presets,
      },
    });
    if (result.status !== 200) {
      throw new Error(`provisioning failed: ${JSON.stringify(result.body)}`);
    }

    const login = await loginWithPin(db, { workspaceSlug: slug, username, pin });
    if (!login.ok) throw new Error("provisioned admin could not log in");
    return { workspaceId, token: login.session.token };
  }

  function setPreset(
    token: string,
    payload: { presetCode: string; enabled: boolean },
    commandId = randomUUID(),
  ) {
    return testApp.app.inject({
      method: "POST",
      url: "/v1/commands/set-template-preset",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        envelope: {
          commandId,
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload,
      },
    });
  }

  function me(token: string) {
    return testApp.app
      .inject({ method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${token}` } })
      .then((response) => {
        expect(response.statusCode).toBe(200);
        return response.json() as { enabledPresets: string[] };
      });
  }

  function templateRows(workspaceId: string) {
    return db
      .select()
      .from(workspaceTemplates)
      .where(eq(workspaceTemplates.workspaceId, workspaceId))
      .orderBy(asc(workspaceTemplates.presetCode));
  }

  it("materializes the whole preset set on the first write, without disabling the untouched one", async () => {
    const { workspaceId, token } = await grandfatheredTenant();
    expect(await templateRows(workspaceId)).toHaveLength(0);
    expect(await inWorkspace(db, workspaceId, (tx) => enabledPresets(tx, workspaceId))).toEqual([
      "TRUCKING",
      "PASSENGER_TRANSPORT",
    ]);

    const commandId = randomUUID();
    const response = await setPreset(
      token,
      { presetCode: "TRUCKING", enabled: false },
      commandId,
    );
    expect(response.statusCode).toBe(200);

    const rows = await templateRows(workspaceId);
    expect(rows.map((row) => [row.presetCode, row.enabled])).toEqual([
      ["PASSENGER_TRANSPORT", true],
      ["TRUCKING", false],
    ]);
    expect(rows.every((row) => row.updatedByCommandId === commandId)).toBe(true);
    expect(rows.every((row) => row.rowVersion === 1)).toBe(true);

    // The workspace has left the grandfather clause: no preset reads UNCONFIGURED.
    const enablement = await inWorkspace(db, workspaceId, async (tx) => ({
      trucking: await presetEnablement(tx, workspaceId, "TRUCKING"),
      passenger: await presetEnablement(tx, workspaceId, "PASSENGER_TRANSPORT"),
    }));
    expect(enablement).toEqual({ trucking: "DISABLED", passenger: "ENABLED" });

    expect((await me(token)).enabledPresets).toEqual(["PASSENGER_TRANSPORT"]);

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.commandId, commandId));
    const byType = new Map(events.map((event) => [event.eventType, event]));
    expect(byType.get("template_preset.disabled")?.afterState).toMatchObject({
      presetCode: "TRUCKING",
      enabled: false,
    });
    // The rows the transition wrote on the caller's behalf are on the trail too.
    expect(byType.get("template_preset.materialized")?.afterState).toMatchObject({
      presetCode: "PASSENGER_TRANSPORT",
      enabled: true,
    });
  });

  it("refuses to disable the last enabled preset", async () => {
    const { workspaceId, token } = await provisionedTenant(["TRUCKING"]);

    const response = await setPreset(token, { presetCode: "TRUCKING", enabled: false });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("LAST_PRESET");

    expect((await templateRows(workspaceId)).map((row) => [row.presetCode, row.enabled])).toEqual(
      [["TRUCKING", true]],
    );
    expect((await me(token)).enabledPresets).toEqual(["TRUCKING"]);
  });

  it("adds a preset the tenant was not provisioned with, then turns it back off", async () => {
    const { workspaceId, token } = await provisionedTenant(["TRUCKING"]);

    const enable = await setPreset(token, {
      presetCode: "PASSENGER_TRANSPORT",
      enabled: true,
    });
    expect(enable.statusCode).toBe(200);
    expect(enable.json().rowVersion).toBe(1);
    expect((await me(token)).enabledPresets).toEqual(["TRUCKING", "PASSENGER_TRANSPORT"]);

    const disableCommandId = randomUUID();
    const disable = await setPreset(
      token,
      { presetCode: "PASSENGER_TRANSPORT", enabled: false },
      disableCommandId,
    );
    expect(disable.statusCode).toBe(200);
    expect(disable.json().rowVersion).toBe(2);
    expect((await me(token)).enabledPresets).toEqual(["TRUCKING"]);

    const [audit] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.commandId, disableCommandId));
    expect(audit?.eventType).toBe("template_preset.disabled");
    expect(audit?.beforeState).toMatchObject({ enabled: true, rowVersion: 1 });
    expect(audit?.afterState).toMatchObject({ enabled: false, rowVersion: 2 });

    const rows = await templateRows(workspaceId);
    expect(rows.map((row) => [row.presetCode, row.enabled])).toEqual([
      ["PASSENGER_TRANSPORT", false],
      ["TRUCKING", true],
    ]);
  });

  it("refuses a write that would change nothing", async () => {
    const { token } = await provisionedTenant(["TRUCKING", "PASSENGER_TRANSPORT"]);

    const response = await setPreset(token, { presetCode: "TRUCKING", enabled: true });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("PRESET_ALREADY_SET");
  });

  it("is DIRECTOR-only", async () => {
    const seeded = await seedWorkspace(db);
    const ops = await seedMember(db, {
      workspaceId: seeded.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    const session = await createSession(db, {
      principalId: ops.principal.id,
      workspaceId: seeded.workspace.id,
    });

    const response = await setPreset(session.token, {
      presetCode: "TRUCKING",
      enabled: false,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("ROLE_FORBIDDEN");
    expect(await templateRows(seeded.workspace.id)).toHaveLength(0);
  });
});
