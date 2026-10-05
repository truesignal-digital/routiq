import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { approvalRules } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import { z } from "zod";
import { listCommands, registerCommand } from "./dispatcher.js";
import { currentPeriodCode } from "./periods.js";

/** A record waiting for a decision, made by the member who will try to decide it. */
interface Pending {
  payload: Record<string, unknown>;
  expectedVersion: number;
}

/**
 * Nobody approves a record they submitted (ADR-0009). Every registered decision
 * command (`approve-*`, `reject-*`) is listed here with a way to make a pending
 * record as one member; that same member deciding it must get
 * MAKER_CANNOT_APPROVE, and a second member of the same role must not. A new
 * decision command fails the first test until it has a row.
 */
describe("maker/checker on every decision command", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let assetId: string;
  let makerToken: string;
  let checkerToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;
    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;

    // Both members hold DIRECTOR, the role that may decide everything, so the
    // only thing that can refuse the maker is the maker check itself.
    const token = async () => {
      const member = await seedMember(db, { workspaceId, role: "DIRECTOR", allBranches: true });
      return (await createSession(db, { workspaceId, principalId: member.principal.id })).token;
    };
    makerToken = await token();
    checkerToken = await token();

    // Tenant rules that hold Direction's own records for review: its unbounded
    // money rules go, and work orders above 100 000 need an Administrateur.
    await db
      .delete(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, workspaceId),
          eq(approvalRules.commandType, "record-expense"),
          eq(approvalRules.requiredRole, "DIRECTOR"),
          isNull(approvalRules.amountMaxMinor),
        ),
      );
    await db.insert(approvalRules).values(
      ["create-work-order", "complete-work-order"].map((commandType) => ({
        workspaceId,
        commandType,
        amountMinMinor: 100_000n,
        requiredRole: "ADMIN" as const,
      })),
    );

    assetId = randomUUID();
    expect(
      (
        await post(makerToken, "register-asset", {
          assetId,
          assetCode: `MAKER-${assetId.slice(0, 8)}`,
          assetClassCode: "TRUCK",
          templateCode: "TRUCKING",
          branchCode: "DLA",
        })
      ).statusCode,
    ).toBe(200);
  });

  afterAll(async () => {
    await ctx.close();
  });

  function post(
    token: string,
    name: string,
    payload: Record<string, unknown>,
    envelope: Record<string, unknown> = {},
  ) {
    return ctx.app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
          ...envelope,
        },
        payload,
      },
    });
  }

  async function expectOk(response: Awaited<ReturnType<typeof post>>, recordStatus: string) {
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ recordStatus });
  }

  async function pendingEntry(): Promise<string> {
    const entryId = randomUUID();
    await expectOk(
      await post(makerToken, "record-expense", {
        entryId,
        branchCode: "DLA",
        categoryCode: "FUEL",
        economicDate: `${currentPeriodCode(new Date(), "Africa/Douala")}-15`,
        amountMinor: 150_000,
        paymentMethod: "MOMO",
        paymentReference: `MOMO-${randomUUID()}`,
        postings: [{ assetId, amountMinor: 150_000 }],
      }),
      "SUBMITTED",
    );
    return entryId;
  }

  async function submittedWorkOrder(): Promise<string> {
    const workOrderId = randomUUID();
    await expectOk(
      await post(makerToken, "create-work-order", {
        workOrderId,
        assetId,
        description: "Boîte de vitesses",
        expectedCostMinor: 500_000,
      }),
      "SUBMITTED",
    );
    return workOrderId;
  }

  /** Approved by the checker, then declared complete by the maker. */
  async function completionSubmitted(): Promise<string> {
    const workOrderId = await submittedWorkOrder();
    await expectOk(
      await post(checkerToken, "approve-work-order", { workOrderId }, { expectedVersion: 1 }),
      "APPROVED",
    );
    await expectOk(
      await post(
        makerToken,
        "complete-work-order",
        { workOrderId, actualCostMinor: 520_000, summary: "Boîte refaite" },
        { expectedVersion: 2 },
      ),
      "COMPLETION_SUBMITTED",
    );
    return workOrderId;
  }

  const DECISIONS: Record<string, () => Promise<Pending>> = {
    "approve-entry": async () => ({ payload: { entryId: await pendingEntry() }, expectedVersion: 1 }),
    "reject-entry": async () => ({
      payload: { entryId: await pendingEntry(), reason: "Doublon" },
      expectedVersion: 1,
    }),
    "approve-work-order": async () => ({
      payload: { workOrderId: await submittedWorkOrder() },
      expectedVersion: 1,
    }),
    "reject-work-order": async () => ({
      payload: { workOrderId: await submittedWorkOrder(), reason: "Trop cher" },
      expectedVersion: 1,
    }),
    "approve-work-order-closure": async () => ({
      payload: { workOrderId: await completionSubmitted() },
      expectedVersion: 3,
    }),
    "reject-work-order-completion": async () => ({
      payload: { workOrderId: await completionSubmitted(), reason: "Facture manquante" },
      expectedVersion: 3,
    }),
  };

  it("covers every registered decision command", () => {
    const registered = listCommands()
      .map((key) => key.slice(0, key.lastIndexOf(".")))
      .filter((name) => /^(approve|reject)-/.test(name));
    expect([...new Set(registered)].sort()).toEqual(Object.keys(DECISIONS).sort());
  });

  it("refuses to register a decision command that names no maker", () => {
    expect(() =>
      registerCommand({
        name: "approve-something-new",
        version: 1,
        module: "CORE",
        allowedRoles: ["DIRECTOR"],
        payloadSchema: z.object({}),
        branchAuthorization: { kind: "workspace" },
        execute: () => Promise.resolve({ recordId: randomUUID(), rowVersion: 1 }),
      }),
    ).toThrow("decision command names no maker: approve-something-new.v1");
  });

  for (const [name, makePending] of Object.entries(DECISIONS)) {
    it(`${name} refuses the member who made the record, not a colleague`, async () => {
      const pending = await makePending();
      const byMaker = await post(makerToken, name, pending.payload, {
        expectedVersion: pending.expectedVersion,
      });
      expect(byMaker.statusCode).toBe(403);
      expect(byMaker.json()).toMatchObject({ error: { code: "MAKER_CANNOT_APPROVE" } });

      const byChecker = await post(checkerToken, name, pending.payload, {
        expectedVersion: pending.expectedVersion,
      });
      expect(byChecker.statusCode, byChecker.body).toBe(200);
    });
  }
});
