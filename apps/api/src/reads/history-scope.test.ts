import { randomUUID } from "node:crypto";
import { historyListResponse, type HistoryEntityType, type Role } from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

/** #58: a record's history is visible exactly where the record itself is. */
describe("history branch scope (#58)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const tokens = new Map<string, string>();
  const ids = { dla: {} as Record<string, string>, yde: {} as Record<string, string> };
  let entryId = "";

  const token = (key: string) => {
    const value = tokens.get(key);
    if (value === undefined) throw new Error(`no token ${key}`);
    return value;
  };

  async function command(name: string, payload: object) {
    const response = await ctx.app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${token("admin")}` },
      payload: {
        version: 1,
        envelope: { commandId: randomUUID(), idempotencyKey: randomUUID(), origin: "HUMAN_UI" },
        payload,
      },
    });
    expect(response.statusCode, `${name}: ${response.body}`).toBe(200);
  }

  const history = (key: string, type: HistoryEntityType, id: string, eventId?: string) =>
    ctx.app.inject({
      method: "GET",
      url: `/v1/history/${type}/${id}${eventId === undefined ? "" : `/${eventId}`}`,
      headers: { authorization: `Bearer ${token(key)}` },
    });

  async function firstEventId(type: HistoryEntityType, id: string) {
    const body = historyListResponse.parse((await history("admin", type, id)).json());
    const event = body.items[0];
    if (event === undefined) throw new Error(`no history for ${type} ${id}`);
    return event.eventId;
  }

  async function member(workspaceId: string, key: string, role: Role, branchIds: string[] | "ALL") {
    const seeded = await seedMember(ctx.db, {
      workspaceId,
      role,
      allBranches: branchIds === "ALL",
      branchIds: branchIds === "ALL" ? [] : branchIds,
    });
    tokens.set(key, (await createSession(ctx.db, { principalId: seeded.principal.id, workspaceId })).token);
  }

  async function recordsIn(branchCode: "DLA" | "YDE") {
    const assetId = randomUUID();
    await command("register-asset", {
      assetId,
      assetCode: `${branchCode}-${assetId.slice(0, 6)}`,
      assetClassCode: "TRUCK",
      templateCode: "TRUCKING",
      branchCode,
    });
    const documentId = randomUUID();
    await command("add-or-renew-document", { documentId, assetId, documentTypeCode: "INSURANCE" });
    const personId = randomUUID();
    await command("register-person", { personId, displayName: `Driver ${branchCode}`, branchCode, defaultRole: "DRIVER" });
    const activityId = randomUUID();
    await command("record-haulage-job-sheet", {
      activityId,
      close: true,
      branchCode,
      activityTypeCode: "HAULAGE_JOB",
      primarySegmentId: randomUUID(),
      primaryAssetId: assetId,
      startedAt: "2026-07-10T06:10:00Z",
      endedAt: "2026-07-11T09:00:00Z",
      customerName: "Brasseries du Cameroun",
      startReading: { readingId: randomUUID(), readingType: "ODOMETER", value: 410_000, observedAt: "2026-07-10T06:10:00Z" },
      endReading: { readingId: randomUUID(), readingType: "ODOMETER", value: 411_125, observedAt: "2026-07-11T09:00:00Z" },
      crew: [{ activityPersonId: randomUUID(), personId, role: "DRIVER" }],
      legs: [
        {
          legId: randomUUID(),
          legNo: 1,
          origin: { kind: "text", text: "Douala" },
          destination: { kind: "text", text: "Yaoundé" },
          distanceKm: 245,
          loadState: "LADEN",
        },
      ],
    });
    return { asset: assetId, document: documentId, person: personId, activity: activityId };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await seedWorkspace(ctx.db);
    const workspaceId = seeded.workspace.id;
    await member(workspaceId, "admin", "ADMIN", "ALL");
    const ydeBranchId = randomUUID();
    await command("create-branch", { branchId: ydeBranchId, code: "YDE", name: "Yaoundé" });
    await member(workspaceId, "dlaOps", "OPS_MANAGER", [seeded.branch.id]);
    await member(workspaceId, "dlaMaintenance", "MAINTENANCE", [seeded.branch.id]);
    ids.dla = await recordsIn("DLA");
    ids.yde = await recordsIn("YDE");

    entryId = randomUUID();
    await command("record-expense", {
      entryId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-09-04",
      amountMinor: 25000,
      paymentMethod: "CASH",
      postings: [{ amountMinor: 25000 }],
    });
  });

  afterAll(async () => {
    await ctx?.close();
  });

  const BRANCH_BOUND = ["asset", "activity", "document", "person"] as const;

  it.each(BRANCH_BOUND)("hides an out-of-branch %s's timeline and event diff", async (type) => {
    const outside = ids.yde[type]!;
    const eventId = await firstEventId(type, outside);
    for (const response of [await history("dlaOps", type, outside), await history("dlaOps", type, outside, eventId)]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: { code: "REFERENCE_NOT_FOUND" } });
    }
  });

  it.each(BRANCH_BOUND)("shows an in-branch %s's timeline and event diff", async (type) => {
    const inside = ids.dla[type]!;
    const eventId = await firstEventId(type, inside);
    expect((await history("dlaOps", type, inside)).statusCode).toBe(200);
    expect((await history("dlaOps", type, inside, eventId)).statusCode).toBe(200);
  });

  it("answers 404 for a record that does not exist, like the detail reads", async () => {
    expect((await history("dlaOps", "asset", randomUUID())).statusCode).toBe(404);
  });

  it("keeps workspace-level history visible to a branch-scoped member", async () => {
    expect((await history("dlaOps", "workspace", randomUUID())).statusCode).toBe(200);
  });

  it("refuses finance history to a role outside the finance readers, even in its own branch", async () => {
    const response = await history("dlaMaintenance", "financial_entry", entryId);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: { code: "ROLE_FORBIDDEN" } });
    expect((await history("dlaMaintenance", "posting_period", randomUUID())).statusCode).toBe(403);
    expect((await history("dlaOps", "financial_entry", entryId)).statusCode).toBe(200);
  });
});
