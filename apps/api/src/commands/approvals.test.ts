import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { approvalRules, assets, commands } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

describe("approval evaluation", () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;

  beforeAll(async () => {
    testApp = await createTestApp();
    db = testApp.db;
  });

  afterAll(async () => {
    await testApp.close();
  });

  async function seedAdmin() {
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
    return { ...seeded, token: session.token };
  }

  async function registerAsset(
    token: string,
    opts: {
      assetId?: string;
      commandId?: string;
      idempotencyKey?: string;
      acquisitionAmountMinor?: number;
    } = {},
  ) {
    const assetId = opts.assetId ?? randomUUID();
    const commandId = opts.commandId ?? randomUUID();
    const idempotencyKey = opts.idempotencyKey ?? `idem-${randomUUID()}`;
    const response = await testApp.app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "register-asset",
        version: 1,
        envelope: {
          commandId,
          idempotencyKey,
          origin: "HUMAN_UI",
        },
        payload: {
          assetId,
          assetCode: `TRUCK-${randomUUID().slice(0, 8)}`,
          assetClassCode: "TRUCK",
          templateCode: "TRUCKING",
          branchCode: "DLA",
          ...(opts.acquisitionAmountMinor === undefined
            ? {}
            : { acquisitionAmountMinor: opts.acquisitionAmountMinor }),
        },
      },
    });
    return { assetId, commandId, idempotencyKey, response };
  }

  it("records the catalog rule that auto-approved a command", async () => {
    const seeded = await seedAdmin();
    const { commandId, response } = await registerAsset(seeded.token);

    expect(response.statusCode).toBe(200);
    const [receipt] = await db.select().from(commands).where(eq(commands.id, commandId));
    expect(receipt?.approvalOutcome).toBe("AUTO_APPROVED");
    expect(receipt?.approvalRuleId).toBeTypeOf("string");
  });

  it("uses the safe default when no rule exists and commits nothing", async () => {
    const seeded = await seedAdmin();
    await db
      .delete(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, seeded.workspace.id),
          eq(approvalRules.commandType, "register-asset"),
        ),
      );

    const { assetId, commandId, response } = await registerAsset(seeded.token);

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: { code: "APPROVAL_REQUIRED", metadata: { commandType: "register-asset" } },
    });
    expect(await db.select().from(assets).where(eq(assets.id, assetId))).toHaveLength(0);
    expect(await db.select().from(commands).where(eq(commands.id, commandId))).toHaveLength(0);
  });

  it("lets a specific tenant rule override a broad catalog default", async () => {
    const seeded = await seedAdmin();
    await db.insert(approvalRules).values({
      workspaceId: seeded.workspace.id,
      commandType: "register-asset",
      categoryCode: "TRUCK",
      requiredRole: "FINANCE",
    });

    const { response } = await registerAsset(seeded.token);
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("APPROVAL_REQUIRED");
  });

  it("a rejected command leaves its idempotency key free for the retry", async () => {
    const seeded = await seedAdmin();
    await db
      .delete(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, seeded.workspace.id),
          eq(approvalRules.commandType, "register-asset"),
        ),
      );

    const first = await registerAsset(seeded.token);
    expect(first.response.statusCode).toBe(403);

    await db.insert(approvalRules).values({
      workspaceId: seeded.workspace.id,
      commandType: "register-asset",
      requiredRole: "ADMIN",
    });

    const retry = await registerAsset(seeded.token, {
      assetId: first.assetId,
      commandId: first.commandId,
      idempotencyKey: first.idempotencyKey,
    });
    expect(retry.response.statusCode).toBe(200);
    expect(retry.response.json().idempotentReplay).toBe(false);
  });

  it("applies amount-range filters to the money on the command", async () => {
    const seeded = await seedAdmin();
    await db
      .delete(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, seeded.workspace.id),
          eq(approvalRules.commandType, "register-asset"),
        ),
      );
    await db.insert(approvalRules).values({
      workspaceId: seeded.workspace.id,
      commandType: "register-asset",
      requiredRole: "ADMIN",
      amountMaxMinor: 1_000_000n,
    });

    const over = await registerAsset(seeded.token, { acquisitionAmountMinor: 2_000_000 });
    expect(over.response.statusCode).toBe(403);
    expect(over.response.json().error.code).toBe("APPROVAL_REQUIRED");

    const under = await registerAsset(seeded.token, { acquisitionAmountMinor: 500_000 });
    expect(under.response.statusCode).toBe(200);
  });
});
