import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { financeSummaryResponse, type Role } from "@routiq/contracts";
import { createSession } from "../auth/local.js";
import { approvalRules, commands, postingPeriods } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { setModule } from "../test/vendor.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import { currentBusinessDate } from "./business-date.js";

describe("GET /v1/finance/summary", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  const tokens = new Map<string, string>();
  const today = currentBusinessDate(new Date(), "Africa/Douala");
  const month = today.slice(0, 7);

  const command = (token: string, name: string, payload: object, expectedVersion?: number) =>
    ctx.app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: randomUUID(),
          origin: "HUMAN_UI",
          ...(expectedVersion === undefined ? {} : { expectedVersion }),
        },
        payload,
      },
    });
  const summary = async (who: string) => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/v1/finance/summary",
      headers: { authorization: `Bearer ${tokens.get(who)}` },
    });
    expect(response.statusCode, response.body).toBe(200);
    return financeSummaryResponse.parse(response.json());
  };
  const expense = (amountMinor: number, economicDate = today) => ({
    entryId: randomUUID(),
    branchCode: "DLA",
    categoryCode: "FUEL",
    economicDate,
    amountMinor,
    paymentMethod: "CASH",
    postings: [{ amountMinor }],
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    // Hold Direction's own expenses for review, so one waits on a second decider.
    await ctx.db
      .delete(approvalRules)
      .where(
        and(
          eq(approvalRules.workspaceId, workspaceId),
          eq(approvalRules.commandType, "record-expense"),
          eq(approvalRules.requiredRole, "DIRECTOR"),
          isNull(approvalRules.amountMaxMinor),
        ),
      );
    const add = async (name: string, role: Role) => {
      const member = await seedMember(ctx.db, { workspaceId, role, allBranches: true });
      tokens.set(name, (await createSession(ctx.db, { workspaceId, principalId: member.principal.id })).token);
    };
    await add("director", "DIRECTOR");
    await add("director2", "DIRECTOR");
    await add("driver", "DRIVER");
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it("counts the waiting entries a decider may decide, never their own", async () => {
    const own = await command(tokens.get("director")!, "record-expense", expense(400_000));
    expect(own.statusCode, own.body).toBe(200);
    const driver = await command(tokens.get("driver")!, "record-expense", expense(150_000));
    expect(driver.statusCode, driver.body).toBe(200);

    const mine = await summary("director");
    expect(mine.month).toBe(month);
    expect(mine.waiting?.count).toBe(1);
    expect(mine.waiting?.amountMinor).toBe(150_000);
    expect(mine.waiting?.oldestSubmittedAt).not.toBeNull();

    const other = await summary("director2");
    expect(other.waiting?.count).toBe(2);
    expect(other.waiting?.amountMinor).toBe(550_000);

    // A role that decides nothing gets no waiting tile, not a zero.
    expect((await summary("driver")).waiting).toBeNull();
  });

  it("totals the month's ledger and counts missing receipts like the entries list", async () => {
    const before = await summary("director2");
    const listed = await ctx.app.inject({
      method: "GET",
      url: "/v1/finance/entries?evidence=MISSING",
      headers: { authorization: `Bearer ${tokens.get("director2")}` },
    });
    expect(before.missingReceipt.count).toBe(listed.json().entries.length);
    expect(before.missingReceipt.count).toBeGreaterThan(0);
    expect(before.outMinor).toBe(0);

    const pending = await ctx.app.inject({
      method: "GET",
      url: "/v1/finance/approvals",
      headers: { authorization: `Bearer ${tokens.get("director2")}` },
    });
    for (const entry of pending.json().entries as { id: string; rowVersion: number }[]) {
      const approved = await command(tokens.get("director2")!, "approve-entry", { entryId: entry.id }, entry.rowVersion);
      expect(approved.statusCode, approved.body).toBe(200);
    }

    const after = await summary("director2");
    expect(after.outMinor).toBe(550_000);
    expect(after.inMinor).toBe(0);
    expect(after.waiting?.count).toBe(0);
    // The current month is open, but it is what the tiles count, not a month left unlocked.
    expect(after.unlockedPeriodCodes).toEqual([]);
    expect(after.lastLockedPeriodCode).toBeNull();

    // A driver's figures are their own entries, as their list is.
    const driver = await summary("driver");
    expect(driver.outMinor).toBe(150_000);
  });

  // #526: the lead names every earlier month still open, not only the latest.
  it("lists every earlier month still open, oldest first, and the last locked one", async () => {
    const [command] = await ctx.db
      .select({ id: commands.id })
      .from(commands)
      .where(eq(commands.workspaceId, workspaceId))
      .limit(1);
    if (!command) throw new Error("seed command not found");
    const one = previousPeriodCode(month);
    const two = previousPeriodCode(one);
    const three = previousPeriodCode(two);
    const period = (periodCode: string, status: "OPEN" | "LOCKED") => ({
      workspaceId,
      periodCode,
      status,
      lockedAt: status === "LOCKED" ? new Date() : null,
      createdByCommandId: command.id,
    });
    await ctx.db
      .insert(postingPeriods)
      .values([period(one, "OPEN"), period(two, "LOCKED"), period(three, "OPEN")])
      .onConflictDoNothing();

    const read = await summary("director");
    expect(read.month).toBe(month);
    expect(read.unlockedPeriodCodes).toEqual([three, one]);
    expect(read.lastLockedPeriodCode).toBe(two);
  });

  it("is refused when the books are off", async () => {
    await setModule(ctx.db, workspaceId, "FINANCE", false);
    const response = await ctx.app.inject({
      method: "GET",
      url: "/v1/finance/summary",
      headers: { authorization: `Bearer ${tokens.get("director")}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: { code: "MODULE_DISABLED", metadata: { module: "FINANCE" } } });
  });
});

function previousPeriodCode(periodCode: string): string {
  const [year, month] = periodCode.split("-").map(Number) as [number, number];
  const prior = new Date(Date.UTC(year, month - 2, 1));
  return `${prior.getUTCFullYear()}-${String(prior.getUTCMonth() + 1).padStart(2, "0")}`;
}
