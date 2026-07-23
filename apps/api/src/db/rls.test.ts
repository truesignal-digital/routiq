import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, inject } from "vitest";
import pg from "pg";
import { createSession } from "../auth/local.js";
import { createTestApp } from "../test/fixture.js";
import { seedWorkspace, seedMember } from "../test/seed.js";
import { auditEvents, commands, assets } from "./schema.js";

/**
 * RLS structural tests: verify tenant isolation below the app layer.
 * Uses raw pg.Client connected as asset_app to test RLS policies.
 */
describe("rls tenant isolation", () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;
  let appClient: pg.Client;
  let workspaceA: Awaited<ReturnType<typeof seedWorkspace>>;
  let workspaceB: Awaited<ReturnType<typeof seedWorkspace>>;

  beforeAll(async () => {
    // Create test app (superuser db)
    testApp = await createTestApp();

    // Seed two workspaces with admin members
    workspaceA = await seedWorkspace(testApp.db, `ws-a-${randomUUID().slice(0, 8)}`);
    workspaceB = await seedWorkspace(testApp.db, `ws-b-${randomUUID().slice(0, 8)}`);

    const memberA = await seedMember(testApp.db, {
      workspaceId: workspaceA.workspace.id,
      role: "ADMIN",
    });

    await seedMember(testApp.db, {
      workspaceId: workspaceB.workspace.id,
      role: "ADMIN",
    });

    await createSession(testApp.db, {
      principalId: memberA.principal.id,
      workspaceId: workspaceA.workspace.id,
    });

    // Seed command receipts for each workspace (for FK references)
    const adminA = await testApp.db.query.memberships.findFirst({
      where: (t, { eq }) => eq(t.workspaceId, workspaceA.workspace.id),
    });
    if (!adminA) throw new Error("admin member A not found");

    const adminB = await testApp.db.query.memberships.findFirst({
      where: (t, { eq }) => eq(t.workspaceId, workspaceB.workspace.id),
    });
    if (!adminB) throw new Error("admin member B not found");

    const commandIdA = randomUUID();
    const commandIdB = randomUUID();

    await testApp.db.insert(commands).values({
      id: commandIdA,
      workspaceId: workspaceA.workspace.id,
      commandType: "seed",
      origin: "API",
      status: "EXECUTED",
      initiatedByPrincipalId: adminA.principalId,
      idempotencyKey: `seed-a-${randomUUID()}`,
      payload: {},
    });

    await testApp.db.insert(commands).values({
      id: commandIdB,
      workspaceId: workspaceB.workspace.id,
      commandType: "seed",
      origin: "API",
      status: "EXECUTED",
      initiatedByPrincipalId: adminB.principalId,
      idempotencyKey: `seed-b-${randomUUID()}`,
      payload: {},
    });

    // Seed one asset per workspace
    await testApp.db.insert(assets).values({
      id: randomUUID(),
      workspaceId: workspaceA.workspace.id,
      branchId: workspaceA.branch.id,
      assetCode: `ASSET-A-${randomUUID().slice(0, 8)}`,
      assetClassCode: "VEHICLE",
      templateCode: "TRUCKING",
      createdByCommandId: commandIdA,
    });

    await testApp.db.insert(assets).values({
      id: randomUUID(),
      workspaceId: workspaceB.workspace.id,
      branchId: workspaceB.branch.id,
      assetCode: `ASSET-B-${randomUUID().slice(0, 8)}`,
      assetClassCode: "VEHICLE",
      templateCode: "TRUCKING",
      createdByCommandId: commandIdB,
    });

    await testApp.db.insert(auditEvents).values({
      workspaceId: workspaceA.workspace.id,
      commandId: commandIdA,
      eventType: "seed.created",
      actorPrincipalId: adminA.principalId,
      entityType: "asset",
      entityId: randomUUID(),
    });

    // Create raw pg.Client as asset_app
    const databaseUrl = inject("databaseUrl");
    const url = new URL(databaseUrl);
    url.username = "asset_app";
    url.password = "asset_app";
    appClient = new pg.Client({ connectionString: url.toString() });
    await appClient.connect();
  });

  afterAll(async () => {
    if (appClient) await appClient.end();
    if (testApp) await testApp.close();
  });

  it("workspace A asset_app sees only A's assets when workspace_id is set", async () => {
    await appClient.query(`SET app.workspace_id = '${workspaceA.workspace.id}'`);
    const result = await appClient.query("SELECT asset_code FROM assets");
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].asset_code).toMatch(/^ASSET-A-/);
  });

  it("workspace A asset_app gets zero rows querying B's workspace_id", async () => {
    await appClient.query(`SET app.workspace_id = '${workspaceA.workspace.id}'`);
    const result = await appClient.query(
      "SELECT asset_code FROM assets WHERE workspace_id = $1",
      [workspaceB.workspace.id],
    );
    expect(result.rows.length).toBe(0);
  });

  it("cross-tenant FK insert is rejected (composite FK violation)", async () => {
    // Set context to workspace A
    await appClient.query(`SET app.workspace_id = '${workspaceA.workspace.id}'`);

    // Get a valid command ID for workspace A
    const cmdResult = await appClient.query(
      "SELECT id FROM commands WHERE workspace_id = $1 LIMIT 1",
      [workspaceA.workspace.id],
    );
    const commandIdA = cmdResult.rows[0]?.id;

    // Try to insert asset with A's workspace but B's branch (cross-tenant FK)
    const insertResult = appClient.query(
      "INSERT INTO assets (id, workspace_id, branch_id, asset_code, asset_class_code, template_code, created_by_command_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [
        randomUUID(),
        workspaceA.workspace.id,
        workspaceB.branch.id,
        `ASSET-CROSS-${randomUUID().slice(0, 8)}`,
        "VEHICLE",
        "TRUCKING",
        commandIdA,
      ],
    );

    await expect(insertResult).rejects.toThrow(
      /constraint|violates|foreign key/i,
    );
  });

  it("RLS WITH CHECK rejects insert with wrong workspace_id", async () => {
    // Set context to workspace A
    await appClient.query(`SET app.workspace_id = '${workspaceA.workspace.id}'`);

    // Get a valid command for workspace A
    const cmdResult = await appClient.query(
      "SELECT id FROM commands WHERE workspace_id = $1 LIMIT 1",
      [workspaceA.workspace.id],
    );
    const commandIdA = cmdResult.rows[0]?.id;

    // Try to insert with workspace_id = B while A is set
    const insertResult = appClient.query(
      "INSERT INTO assets (id, workspace_id, branch_id, asset_code, asset_class_code, template_code, created_by_command_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [
        randomUUID(),
        workspaceB.workspace.id,
        workspaceA.branch.id,
        `ASSET-WRONG-${randomUUID().slice(0, 8)}`,
        "VEHICLE",
        "TRUCKING",
        commandIdA,
      ],
    );

    await expect(insertResult).rejects.toThrow(
      /new row violates row-level security policy|42501/i,
    );
  });

  it("audit_events UPDATE is rejected (append-only via revoke)", async () => {
    // Set context to workspace A
    await appClient.query(`SET app.workspace_id = '${workspaceA.workspace.id}'`);

    // Get an audit event for workspace A
    const eventResult = await appClient.query(
      "SELECT id FROM audit_events WHERE workspace_id = $1 LIMIT 1",
      [workspaceA.workspace.id],
    );

    expect(eventResult.rows).toHaveLength(1);
    const updateResult = appClient.query(
      "UPDATE audit_events SET event_type = $1 WHERE workspace_id = $2",
      ["TAMPERED", workspaceA.workspace.id],
    );

    await expect(updateResult).rejects.toThrow(/permission denied|42501/i);
  });

  it("audit_events DELETE is rejected (append-only via revoke)", async () => {
    // Set context to workspace A
    await appClient.query(`SET app.workspace_id = '${workspaceA.workspace.id}'`);

    const deleteResult = appClient.query(
      "DELETE FROM audit_events WHERE workspace_id = $1",
      [workspaceA.workspace.id],
    );

    await expect(deleteResult).rejects.toThrow(/permission denied|42501/i);
  });

  it("no app.workspace_id set returns zero rows", async () => {
    // Fresh connection to guarantee no workspace_id is set
    const freshUrl = new URL(inject("databaseUrl"));
    freshUrl.username = "asset_app";
    freshUrl.password = "asset_app";
    const freshClient = new pg.Client({ connectionString: freshUrl.toString() });
    await freshClient.connect();

    try {
      const result = await freshClient.query("SELECT * FROM assets");
      expect(result.rows.length).toBe(0);
      const sessions = await freshClient.query("SELECT * FROM sessions");
      expect(sessions.rows.length).toBe(0);
    } finally {
      await freshClient.end();
    }
  });
});
