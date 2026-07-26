import { updateApprovalThresholdPayload } from "@routiq/contracts";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { financialEntries } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

describe("update-approval-threshold contract", () => {
  function validatePayload(payload: unknown) {
    return updateApprovalThresholdPayload.parse(payload);
  }

  it("round-trips a valid payload", () => {
    const payload = {
      commandType: "record-expense" as const,
      amountMaxMinor: 200_000,
    };

    expect(validatePayload(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
  });

  it("allows zero at the lower boundary and rejects values below it", () => {
    expect(
      validatePayload({
        commandType: "record-expense",
        amountMaxMinor: 0,
      }),
    ).toEqual({
      commandType: "record-expense",
      amountMaxMinor: 0,
    });
    expect(
      updateApprovalThresholdPayload.safeParse({
        commandType: "record-expense",
        amountMaxMinor: -1,
      }).success,
    ).toBe(false);
  });
});

describe("update-approval-threshold.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let branchId: string;
  let adminToken: string;
  let opsManagerToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;

    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;
    branchId = seeded.branch.id;

    const admin = await seedMember(db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    adminToken = (
      await createSession(db, {
        principalId: admin.principal.id,
        workspaceId,
      })
    ).token;

    const opsManager = await seedMember(db, {
      workspaceId,
      role: "OPS_MANAGER",
      allBranches: true,
    });
    opsManagerToken = (
      await createSession(db, {
        principalId: opsManager.principal.id,
        workspaceId,
      })
    ).token;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("returns 403 when a non-ADMIN tries to update a threshold", async () => {
    const response = await postCommand(
      opsManagerToken,
      "update-approval-threshold",
      {
        commandType: "record-expense",
        amountMaxMinor: 200_000,
      },
    );

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: "ROLE_FORBIDDEN",
        metadata: { command: "update-approval-threshold.v1" },
      },
    });
  });

  it("allows ADMIN to update threshold with status 200", async () => {
    const response = await postCommand(
      adminToken,
      "update-approval-threshold",
      {
        commandType: "record-expense",
        amountMaxMinor: 250_000,
      },
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty("commandId");
    expect(response.json()).toHaveProperty("warnings");
  });

  it("threshold change affects entry posting behavior", async () => {
    // Set threshold to 100_000
    await postCommand(adminToken, "update-approval-threshold", {
      commandType: "record-expense",
      amountMaxMinor: 100_000,
    });

    // Record 150_000 expense → should be SUBMITTED (above 100_000 threshold)
    const entryId1 = randomUUID();
    let response = await postCommand(opsManagerToken, "record-expense", {
      entryId: entryId1,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-07-24",
      amountMinor: 150_000,
      paymentMethod: "CASH",
      postings: [{ amountMinor: 150_000 }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().recordStatus).toBe("SUBMITTED");

    let [entry1] = await db
      .select({ status: financialEntries.status })
      .from(financialEntries)
      .where(eq(financialEntries.id, entryId1));
    expect(entry1?.status).toBe("SUBMITTED");

    // Raise threshold to 200_000
    await postCommand(adminToken, "update-approval-threshold", {
      commandType: "record-expense",
      amountMaxMinor: 200_000,
    });

    // Record 150_000 expense → should be POSTED (now below 200_000 threshold)
    const entryId2 = randomUUID();
    response = await postCommand(opsManagerToken, "record-expense", {
      entryId: entryId2,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-07-24",
      amountMinor: 150_000,
      paymentMethod: "CASH",
      postings: [{ amountMinor: 150_000 }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().recordStatus).toBe("POSTED");

    let [entry2] = await db
      .select({ status: financialEntries.status })
      .from(financialEntries)
      .where(eq(financialEntries.id, entryId2));
    expect(entry2?.status).toBe("POSTED");

    // Lower threshold back to 100_000
    await postCommand(adminToken, "update-approval-threshold", {
      commandType: "record-expense",
      amountMaxMinor: 100_000,
    });

    // Record 150_000 expense → should be SUBMITTED (back above 100_000 threshold)
    const entryId3 = randomUUID();
    response = await postCommand(opsManagerToken, "record-expense", {
      entryId: entryId3,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-07-24",
      amountMinor: 150_000,
      paymentMethod: "CASH",
      postings: [{ amountMinor: 150_000 }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().recordStatus).toBe("SUBMITTED");

    let [entry3] = await db
      .select({ status: financialEntries.status })
      .from(financialEntries)
      .where(eq(financialEntries.id, entryId3));
    expect(entry3?.status).toBe("SUBMITTED");
  });

  function postCommand(
    token: string,
    name: string,
    payload: Record<string, unknown>,
    commandId = randomUUID(),
  ) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name,
        version: 1,
        envelope: {
          commandId,
          idempotencyKey: `${name}-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload,
      },
    });
  }
});
