import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveOperatorContext } from "../auth/context.js";
import { loginWithPin } from "../auth/local.js";
import { verifyPin } from "../auth/pin.js";
import type { OperatorContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import { platformDb, type PlatformDb } from "../db/platform.js";
import {
  approvalRules,
  auditEvents,
  branches,
  categories,
  commands,
  credentials,
  financialEntries,
  memberships,
  principals,
  workspaceModules,
  workspaceTemplates,
  workspaces,
} from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { corePack } from "../provisioning/packs/core.js";
import { passengerTransportPack } from "../provisioning/packs/passenger-transport.js";
import { truckingPack } from "../provisioning/packs/trucking.js";
import { dispatchCommand } from "./dispatcher.js";
import { REDACTED_PIN } from "./provision-workspace.js";
import "../server.js";

describe("provision-workspace.v2", () => {
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

  function provisionBody(
    overrides: {
      slug?: string;
      enabledPresets?: string[];
      disabledModules?: string[];
      idempotencyKey?: string;
      branches?: Array<{ id: string; code: string; name: string; timezone?: string }>;
      users?: Array<{
        id: string;
        displayName: string;
        username: string;
        pin: string;
        role: "ADMIN" | "OPS_MANAGER" | "FIELD_SUBMITTER";
        branchScope: "ALL" | string[];
      }>;
    } = {},
  ) {
    const slug = overrides.slug ?? `tenant-${randomUUID().slice(0, 8)}`;
    return {
      name: "provision-workspace",
      version: 2,
      envelope: {
        commandId: randomUUID(),
        idempotencyKey: overrides.idempotencyKey ?? `idem-${randomUUID()}`,
        origin: "API",
      },
      payload: {
        workspace: { id: randomUUID(), slug, name: `Transports ${slug}` },
        branches: overrides.branches ?? [{ id: randomUUID(), code: "DLA", name: "Douala" }],
        admin: {
          id: randomUUID(),
          displayName: "Awa Ndongo",
          username: `admin-${slug}`,
          pin: "482913",
        },
        enabledPresets: overrides.enabledPresets ?? ["TRUCKING", "PASSENGER_TRANSPORT"],
        ...(overrides.users === undefined ? {} : { users: overrides.users }),
        ...(overrides.disabledModules === undefined
          ? {}
          : { disabledModules: overrides.disabledModules }),
      },
    };
  }

  it("creates the whole tenant in one command, every row stamped with it", async () => {
    const body = provisionBody({ disabledModules: ["DOCUMENTS"] });
    const commandId = body.envelope.commandId;
    const workspaceId = body.payload.workspace.id;

    const result = await dispatchCommand(platform, operator, body);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      commandId,
      recordId: workspaceId,
      rowVersion: 1,
      warnings: [],
      idempotentReplay: false,
    });

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(workspace).toMatchObject({
      slug: body.payload.workspace.slug,
      name: body.payload.workspace.name,
      // Contract defaults, not client input — XAF has exponent 0 (§3.4).
      defaultCurrency: "XAF",
      timezone: "Africa/Douala",
      defaultLocale: "fr-CM",
      status: "ACTIVE",
    });

    const [branch] = await db.select().from(branches).where(eq(branches.workspaceId, workspaceId));
    expect(branch).toMatchObject({
      id: body.payload.branches[0]!.id,
      code: "DLA",
      active: true,
      createdByCommandId: commandId,
      rowVersion: 1,
    });

    const [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.workspaceId, workspaceId));
    expect(membership).toMatchObject({
      principalId: body.payload.admin.id,
      role: "ADMIN",
      allBranches: true,
    });

    const [credential] = await db
      .select()
      .from(credentials)
      .where(eq(credentials.workspaceId, workspaceId));
    expect(credential?.username).toBe(body.payload.admin.username);
    expect(credential?.pinHash).not.toContain(body.payload.admin.pin);
    expect(await verifyPin(body.payload.admin.pin, credential?.pinHash ?? "")).toBe(true);

    const templates = await db
      .select()
      .from(workspaceTemplates)
      .where(eq(workspaceTemplates.workspaceId, workspaceId));
    expect(templates.map((t) => t.presetCode).sort()).toEqual([
      "PASSENGER_TRANSPORT",
      "TRUCKING",
    ]);
    expect(templates.every((t) => t.enabled && t.updatedByCommandId === commandId)).toBe(true);

    // Absent means enabled: only the disabled module gets a row.
    const modules = await db
      .select()
      .from(workspaceModules)
      .where(eq(workspaceModules.workspaceId, workspaceId));
    expect(modules).toHaveLength(1);
    expect(modules[0]).toMatchObject({
      moduleCode: "DOCUMENTS",
      enabled: false,
      updatedByCommandId: commandId,
    });

    const categoryRows = await db
      .select()
      .from(categories)
      .where(eq(categories.workspaceId, workspaceId));
    expect(categoryRows).toHaveLength(
      corePack.categories.length +
        truckingPack.categories.length +
        passengerTransportPack.categories.length,
    );
    expect(categoryRows.every((row) => row.createdByCommandId === commandId)).toBe(true);

    const ruleRows = await db
      .select()
      .from(approvalRules)
      .where(eq(approvalRules.workspaceId, workspaceId));
    expect(ruleRows).toHaveLength(corePack.approvalRules.length);
    expect(ruleRows.every((row) => row.createdByCommandId === commandId)).toBe(true);

    const [receipt] = await db.select().from(commands).where(eq(commands.id, commandId));
    expect(receipt).toMatchObject({
      scope: "PLATFORM",
      status: "EXECUTED",
      workspaceId,
      commandType: "provision-workspace",
      initiatedByPrincipalId: operator.principalId,
    });
  });

  /**
   * A receipt is kept forever and lands in every backup and export, so the PIN
   * must not survive in it — the audit trail redacting it is not enough.
   */
  it("keeps the PIN out of the stored receipt payload", async () => {
    const body = provisionBody();
    expect((await dispatchCommand(platform, operator, body)).status).toBe(200);

    const [receipt] = await db
      .select({ payload: commands.payload })
      .from(commands)
      .where(eq(commands.id, body.envelope.commandId));

    const stored = receipt?.payload as { admin: { pin: string; username: string } };
    expect(stored.admin.pin).toBe(REDACTED_PIN);
    expect(JSON.stringify(receipt)).not.toContain(body.payload.admin.pin);
    // Everything else survives, or the receipt would stop being a record of what ran.
    expect(stored.admin.username).toBe(body.payload.admin.username);
  });

  it("still rejects a reused key carrying a genuinely different payload", async () => {
    const idempotencyKey = `idem-${randomUUID()}`;
    const first = provisionBody({ idempotencyKey });
    expect((await dispatchCommand(platform, operator, first)).status).toBe(200);

    const different = provisionBody({ idempotencyKey });
    different.payload.branches[0]!.code = "YDE";

    const result = await dispatchCommand(platform, operator, different);

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: { code: "IDEMPOTENCY_KEY_REUSED" } });
  });

  it("keeps the PIN out of the audit trail", async () => {
    const body = provisionBody();
    expect((await dispatchCommand(platform, operator, body)).status).toBe(200);

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.commandId, body.envelope.commandId));
    expect(event).toMatchObject({
      scope: "PLATFORM",
      eventType: "workspace.provisioned",
      entityType: "workspace",
      entityId: body.payload.workspace.id,
      actorPrincipalId: operator.principalId,
    });

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(body.payload.admin.pin);
    expect(serialized).not.toContain("pinHash");
    expect(serialized).toContain(body.payload.admin.username);
  });

  /**
   * The point of provisioning is a workspace someone can actually use, so this
   * goes all the way through the front door: log in with the PIN the command
   * set, then run a tenant command that needs the branch and the approval rule
   * the same command created.
   */
  it("produces an admin who can log in and run a tenant command", async () => {
    const body = provisionBody();
    expect((await dispatchCommand(platform, operator, body)).status).toBe(200);

    const login = await loginWithPin(db, {
      workspaceSlug: body.payload.workspace.slug,
      username: body.payload.admin.username,
      pin: body.payload.admin.pin,
    });
    expect(login.ok).toBe(true);
    if (!login.ok) return;

    const assetId = randomUUID();
    const response = await testApp.app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: { authorization: `Bearer ${login.session.token}` },
      payload: {
        name: "register-asset",
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: {
          assetId,
          assetCode: "TRUCK-001",
          assetClassCode: "TRUCK",
          templateCode: "TRUCKING",
          branchCode: "DLA",
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ recordId: assetId });
  });

  it("creates multiple users with their roles, credentials, and branch scopes", async () => {
    const allBranchesUser = {
      id: randomUUID(),
      displayName: "Boris Nguema",
      username: `boris-${randomUUID()}`,
      pin: "ops-pin-222222",
      role: "OPS_MANAGER" as const,
      branchScope: "ALL" as const,
    };
    const scopedUser = {
      id: randomUUID(),
      displayName: "Sali Mbarga",
      username: `sali-${randomUUID()}`,
      pin: "field-pin-333333",
      role: "FIELD_SUBMITTER" as const,
      branchScope: ["DLA"],
    };
    const body = provisionBody({ users: [allBranchesUser, scopedUser] });

    expect((await dispatchCommand(platform, operator, body)).status).toBe(200);

    const principalRows = await db
      .select()
      .from(principals)
      .where(eq(principals.principalType, "HUMAN"));
    expect(principalRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: allBranchesUser.id,
          displayName: allBranchesUser.displayName,
        }),
        expect.objectContaining({
          id: scopedUser.id,
          displayName: scopedUser.displayName,
        }),
      ]),
    );

    const membershipRows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.workspaceId, body.payload.workspace.id));
    expect(membershipRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          principalId: allBranchesUser.id,
          role: "OPS_MANAGER",
          allBranches: true,
          branchIds: [],
        }),
        expect.objectContaining({
          principalId: scopedUser.id,
          role: "FIELD_SUBMITTER",
          allBranches: false,
          branchIds: [body.payload.branches[0]!.id],
        }),
      ]),
    );

    for (const user of [allBranchesUser, scopedUser]) {
      const login = await loginWithPin(db, {
        workspaceSlug: body.payload.workspace.slug,
        username: user.username,
        pin: user.pin,
      });
      expect(login.ok).toBe(true);
    }

    const [receipt] = await db
      .select({ payload: commands.payload })
      .from(commands)
      .where(eq(commands.id, body.envelope.commandId));
    const serializedReceipt = JSON.stringify(receipt);
    expect(serializedReceipt).not.toContain(allBranchesUser.pin);
    expect(serializedReceipt).not.toContain(scopedUser.pin);
    expect(serializedReceipt).toContain(REDACTED_PIN);
  });

  /** A travel agency arrives with Douala, Yaoundé and Bafoussam on day one. */
  it("creates every branch in the payload, each numbering its own records", async () => {
    const branchList = [
      { id: randomUUID(), code: "DLA", name: "Douala" },
      { id: randomUUID(), code: "YDE", name: "Yaoundé", timezone: "Africa/Douala" },
      { id: randomUUID(), code: "BAF", name: "Bafoussam" },
    ];
    const body = provisionBody({ branches: branchList, enabledPresets: ["TRUCKING"] });
    const commandId = body.envelope.commandId;

    expect((await dispatchCommand(platform, operator, body)).status).toBe(200);

    const rows = await db
      .select()
      .from(branches)
      .where(eq(branches.workspaceId, body.payload.workspace.id));
    expect(rows.map((row) => row.code).sort()).toEqual(["BAF", "DLA", "YDE"]);
    expect(new Set(rows.map((row) => row.id))).toEqual(new Set(branchList.map((b) => b.id)));
    expect(
      rows.every(
        (row) => row.active && row.rowVersion === 1 && row.createdByCommandId === commandId,
      ),
    ).toBe(true);

    const login = await loginWithPin(db, {
      workspaceSlug: body.payload.workspace.slug,
      username: body.payload.admin.username,
      pin: body.payload.admin.pin,
    });
    expect(login.ok).toBe(true);
    if (!login.ok) return;

    const entryNumbers: string[] = [];
    for (const branchCode of ["DLA", "YDE", "DLA"]) {
      const entryId = randomUUID();
      const response = await testApp.app.inject({
        method: "POST",
        url: "/v1/commands/record-expense",
        headers: { authorization: `Bearer ${login.session.token}` },
        payload: {
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey: `idem-${randomUUID()}`,
            origin: "HUMAN_UI",
          },
          payload: {
            entryId,
            branchCode,
            categoryCode: "FUEL",
            economicDate: "2026-03-04",
            amountMinor: 50_000,
            paymentMethod: "CASH",
            postings: [{ amountMinor: 50_000 }],
          },
        },
      });
      expect(response.statusCode).toBe(200);

      const [entry] = await db
        .select({ entryNumber: financialEntries.entryNumber })
        .from(financialEntries)
        .where(eq(financialEntries.id, entryId));
      entryNumbers.push(entry?.entryNumber ?? "");
    }

    // Counters are scoped per branch, so Yaoundé opens its own series at 1.
    expect(entryNumbers).toEqual(["DLA-2026-00001", "YDE-2026-00001", "DLA-2026-00002"]);
  });

  it("gives a scoped user exactly the branch ids its codes name", async () => {
    const branchList = [
      { id: randomUUID(), code: "DLA", name: "Douala" },
      { id: randomUUID(), code: "YDE", name: "Yaoundé" },
      { id: randomUUID(), code: "BAF", name: "Bafoussam" },
    ];
    const scopedUser = {
      id: randomUUID(),
      displayName: "Sali Mbarga",
      username: `sali-${randomUUID()}`,
      pin: "field-pin-333333",
      role: "FIELD_SUBMITTER" as const,
      branchScope: ["DLA", "BAF"],
    };
    const body = provisionBody({ branches: branchList, users: [scopedUser] });

    expect((await dispatchCommand(platform, operator, body)).status).toBe(200);

    const [membership] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.workspaceId, body.payload.workspace.id),
          eq(memberships.principalId, scopedUser.id),
        ),
      );
    expect(membership).toMatchObject({
      role: "FIELD_SUBMITTER",
      allBranches: false,
      branchIds: [branchList[0]!.id, branchList[2]!.id],
    });
  });

  it("rejects a user scoped to a branch code the payload never creates", async () => {
    const scopedUser = {
      id: randomUUID(),
      displayName: "Sali Mbarga",
      username: `sali-${randomUUID()}`,
      pin: "field-pin-333333",
      role: "FIELD_SUBMITTER" as const,
      branchScope: ["DLA", "KRB"],
    };
    const body = provisionBody({
      branches: [{ id: randomUUID(), code: "DLA", name: "Douala" }],
      users: [scopedUser],
    });

    const result = await dispatchCommand(platform, operator, body);

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({
      error: { code: "REFERENCE_NOT_FOUND", metadata: { referenceType: "branch", missing: ["KRB"] } },
    });

    // Nothing half-provisioned: the workspace insert rolls back with the rest.
    expect(
      await db.select().from(workspaces).where(eq(workspaces.id, body.payload.workspace.id)),
    ).toEqual([]);
  });

  it("rejects duplicate branch codes before any row is written", async () => {
    const body = provisionBody({
      branches: [
        { id: randomUUID(), code: "DLA", name: "Douala" },
        { id: randomUUID(), code: "DLA", name: "Douala Bonabéri" },
      ],
    });

    const result = await dispatchCommand(platform, operator, body);

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    expect(
      await db.select().from(workspaces).where(eq(workspaces.id, body.payload.workspace.id)),
    ).toEqual([]);
  });

  it("rejects a duplicate slug with a stable code, not a raw constraint error", async () => {
    const slug = `tenant-${randomUUID().slice(0, 8)}`;
    expect((await dispatchCommand(platform, operator, provisionBody({ slug }))).status).toBe(200);

    const second = provisionBody({ slug });
    const result = await dispatchCommand(platform, operator, second);

    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: { code: "DUPLICATE_WORKSPACE_SLUG", metadata: { slug } },
    });

    const orphans = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, second.payload.workspace.id));
    expect(orphans).toEqual([]);
  });

  it("gives a single-preset workspace core plus that preset only", async () => {
    const body = provisionBody({ enabledPresets: ["TRUCKING"] });
    expect((await dispatchCommand(platform, operator, body)).status).toBe(200);

    const rows = await db
      .select({ kind: categories.kind, code: categories.code })
      .from(categories)
      .where(eq(categories.workspaceId, body.payload.workspace.id));
    const present = new Set(rows.map((row) => `${row.kind}:${row.code}`));

    for (const category of [...corePack.categories, ...truckingPack.categories]) {
      expect(present.has(`${category.kind}:${category.code}`)).toBe(true);
    }
    for (const category of passengerTransportPack.categories) {
      expect(present.has(`${category.kind}:${category.code}`)).toBe(false);
    }

    const templates = await db
      .select()
      .from(workspaceTemplates)
      .where(eq(workspaceTemplates.workspaceId, body.payload.workspace.id));
    expect(templates.map((t) => t.presetCode)).toEqual(["TRUCKING"]);
  });

  it("replays idempotently without provisioning a second time", async () => {
    const body = provisionBody();
    const first = await dispatchCommand(platform, operator, body);
    expect(first.status).toBe(200);

    const replay = await dispatchCommand(platform, operator, body);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ ...first.body, idempotentReplay: true });

    const workspaceId = body.payload.workspace.id;
    expect(
      await db.select().from(workspaces).where(eq(workspaces.slug, body.payload.workspace.slug)),
    ).toHaveLength(1);
    expect(
      await db.select().from(branches).where(eq(branches.workspaceId, workspaceId)),
    ).toHaveLength(1);
    expect(
      await db.select().from(credentials).where(eq(credentials.workspaceId, workspaceId)),
    ).toHaveLength(1);
    expect(
      await db.select().from(categories).where(eq(categories.workspaceId, workspaceId)),
    ).toHaveLength(
      corePack.categories.length +
        truckingPack.categories.length +
        passengerTransportPack.categories.length,
    );
    expect(
      await db
        .select()
        .from(commands)
        .where(
          and(
            eq(commands.idempotencyKey, body.envelope.idempotencyKey),
            eq(commands.status, "EXECUTED"),
          ),
        ),
    ).toHaveLength(1);
  });

  /**
   * The compatibility path (issue #20). v1 is what already-authored tenant files
   * say, so it must still provision — through the same execution path, with its
   * own receipt shape.
   */
  describe("v1 compatibility", () => {
    function legacyBody(
      overrides: { code?: string; idempotencyKey?: string } = {},
    ) {
      const v2 = provisionBody(overrides.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: overrides.idempotencyKey });
      const { branches: _branches, ...payload } = v2.payload;
      return {
        ...v2,
        version: 1,
        payload: {
          ...payload,
          branch: {
            id: randomUUID(),
            code: overrides.code ?? "DLA",
            name: "Douala",
          },
        },
      };
    }

    it("provisions from the singular branch object", async () => {
      const body = legacyBody();
      const workspaceId = body.payload.workspace.id;

      const result = await dispatchCommand(platform, operator, body);

      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ recordId: workspaceId, idempotentReplay: false });

      const rows = await db.select().from(branches).where(eq(branches.workspaceId, workspaceId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: body.payload.branch.id,
        code: "DLA",
        name: "Douala",
        active: true,
        createdByCommandId: body.envelope.commandId,
      });
    });

    it("keeps the loose code rule v2 tightened", async () => {
      const body = legacyBody({ code: "douala-bonaberi" });

      const result = await dispatchCommand(platform, operator, body);

      expect(result.status).toBe(200);
      const [row] = await db
        .select()
        .from(branches)
        .where(eq(branches.workspaceId, body.payload.workspace.id));
      expect(row?.code).toBe("douala-bonaberi");
    });

    it("files its receipt at version 1, in the shape it arrived in", async () => {
      const body = legacyBody();

      await dispatchCommand(platform, operator, body);

      const [receipt] = await db
        .select()
        .from(commands)
        .where(eq(commands.idempotencyKey, body.envelope.idempotencyKey));
      expect(receipt?.commandVersion).toBe("1");
      expect(receipt?.payload).toMatchObject({
        branch: { code: "DLA", name: "Douala" },
        // The receipt is kept forever; the PIN never reaches it.
        admin: { pin: REDACTED_PIN },
      });
    });

    /**
     * Why the seed and the CLI moved to new idempotency keys rather than
     * reusing theirs: the fingerprint is over the raw payload, so no version
     * choice can make a v2 payload replay a v1 receipt.
     */
    it("conflicts when a v2 payload reuses a v1 receipt's idempotency key", async () => {
      const key = `idem-${randomUUID()}`;
      expect((await dispatchCommand(platform, operator, legacyBody({ idempotencyKey: key }))).status)
        .toBe(200);

      const retry = await dispatchCommand(platform, operator, provisionBody({ idempotencyKey: key }));

      expect(retry.status).toBe(409);
      expect(retry.body).toMatchObject({ error: { code: "IDEMPOTENCY_KEY_REUSED" } });
    });
  });
});
