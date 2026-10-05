import { randomUUID } from "node:crypto";
import { registerPersonCommand } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { branches, categories, persons } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import { createSession } from "../auth/local.js";

describe("register-person.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  let branchId: string;
  let token: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    branchId = seeded.branch.id;
    const member = await seedMember(ctx.db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    token = (
      await createSession(ctx.db, {
        workspaceId,
        principalId: member.principal.id,
      })
    ).token;
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function post(payload: Record<string, unknown>, idempotencyKey?: string) {
    const body = registerPersonCommand.parse({
      name: "register-person",
      version: 1,
      envelope: {
        commandId: randomUUID(),
        idempotencyKey: idempotencyKey ?? `idem-${randomUUID()}`,
        origin: "HUMAN_UI",
      },
      payload,
    });
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands/register-person",
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });
  }

  it("registers a driver who has no login", async () => {
    const personId = randomUUID();
    const response = await post({
      personId,
      displayName: "Abdoulaye Sanda",
      branchCode: "DLA",
      personCode: "CH-014",
      defaultRole: "DRIVER",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ recordId: personId, rowVersion: 1 });

    const [row] = await ctx.db
      .select()
      .from(persons)
      .where(and(eq(persons.workspaceId, workspaceId), eq(persons.id, personId)));
    expect(row).toMatchObject({
      displayName: "Abdoulaye Sanda",
      personCode: "CH-014",
      defaultRole: "DRIVER",
      branchId,
      // §3.1: a person may exist without a login, and most drivers never get one.
      membershipId: null,
      active: true,
    });
  });

  it("replays an identical retry instead of creating a second person", async () => {
    const personId = randomUUID();
    const key = `idem-${randomUUID()}`;
    const payload = {
      personId,
      displayName: "Ibrahim Njoya",
      branchCode: "DLA",
    };

    const first = await post(payload, key);
    expect(first.statusCode).toBe(200);
    const second = await post(payload, key);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ recordId: personId, idempotentReplay: true });

    const rows = await ctx.db
      .select()
      .from(persons)
      .where(and(eq(persons.workspaceId, workspaceId), eq(persons.id, personId)));
    expect(rows).toHaveLength(1);
  });

  it("rejects an unknown branch with a stable code, never a sentence", async () => {
    const response = await post({
      personId: randomUUID(),
      displayName: "Moussa Bello",
      branchCode: "NOPE",
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "REFERENCE_NOT_FOUND" },
    });
  });

  it("seeds the activity types and crew-pay categories a sheet needs", async () => {
    const rows = await ctx.db
      .select({ code: categories.code, kind: categories.kind })
      .from(categories)
      .where(eq(categories.workspaceId, workspaceId));
    const byKind = (kind: string) =>
      rows.filter((row) => row.kind === kind).map((row) => row.code);

    expect(byKind("ACTIVITY_TYPE").sort()).toEqual([
      "CHARTER",
      "HAULAGE_JOB",
      "SCHEDULED_JOURNEY",
    ]);
    expect(byKind("EXPENSE_CATEGORY")).toEqual(
      expect.arrayContaining(["DRIVER_ALLOWANCE", "CREW_ALLOWANCE", "TOLLS"]),
    );
  });

  it("keeps the seeded branch reachable by code", async () => {
    const [row] = await ctx.db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.workspaceId, workspaceId), eq(branches.code, "DLA")));
    expect(row?.id).toBe(branchId);
  });
});
