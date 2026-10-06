import { approvalChainResponse, type ApprovalChainResponse, type Role } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvalRuleAcknowledgements, approvalRuleChanges, auditEvents } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedWorkspace } from "../test/seed.js";

/**
 * #422: when Direction moves an approval band, the members it affects are told
 * once, in the app, until they acknowledge it through a command.
 */
describe("approval rules notice (#422)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;

  type Team = Record<Role, Actor> & { workspaceId: string };

  async function team(): Promise<Team> {
    const { workspace } = await seedWorkspace(ctx.db);
    const workspaceId = workspace.id;
    const roles: Role[] = ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"];
    const entries = await Promise.all(
      roles.map(
        async (role) =>
          [
            role,
            await seedActor(ctx.db, {
              workspaceId,
              role,
              ...(role === "DIRECTOR" ? { displayName: `Mme Ngo ${workspaceId.slice(0, 4)}` } : {}),
            }),
          ] as const,
      ),
    );
    return { ...(Object.fromEntries(entries) as Record<Role, Actor>), workspaceId };
  }

  async function chainOf(actor: Actor): Promise<ApprovalChainResponse> {
    const reply = await api.get(actor.token, "/v1/approval-chain");
    expect(reply.status).toBe(200);
    return approvalChainResponse.parse(reply.body);
  }

  async function move(director: Actor, commandType: string, amountMaxMinor: number) {
    return api.ok(director.token, "update-approval-threshold", { commandType, amountMaxMinor });
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("shows nothing in a workspace whose rules never changed", async () => {
    const t = await team();
    for (const role of ["ADMIN", "FINANCE", "DRIVER"] as const) {
      expect((await chainOf(t[role])).notice).toBeNull();
    }
  });

  it("tells every member a recording band change affects, naming who changed it and when", async () => {
    const t = await team();
    const before = Date.now();
    await move(t.DIRECTOR, "record-expense", 150_000);

    for (const role of ["ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"] as const) {
      const { notice } = await chainOf(t[role]);
      expect(notice, role).not.toBeNull();
      expect(notice?.changedBy).toBe(t.DIRECTOR.displayName);
      expect(Date.parse(notice?.changedAt ?? "")).toBeGreaterThanOrEqual(before - 1000);
    }
    // Direction made it, and Direction's own entries post at any amount.
    expect((await chainOf(t.DIRECTOR)).notice).toBeNull();
  });

  it("states each role's own chain in amount bands", async () => {
    const t = await team();
    await move(t.DIRECTOR, "record-expense", 150_000);

    expect((await chainOf(t.ADMIN)).chains).toEqual([
      {
        commandType: "record-expense",
        steps: [
          { upToMinor: 150_000, outcome: "POSTS_DIRECTLY" },
          { upToMinor: 1_000_000, outcome: "FINANCE_APPROVES" },
          { upToMinor: null, outcome: "DIRECTION_APPROVES" },
        ],
      },
      {
        commandType: "record-revenue",
        steps: [
          { upToMinor: 100_000, outcome: "POSTS_DIRECTLY" },
          { upToMinor: 1_000_000, outcome: "FINANCE_APPROVES" },
          { upToMinor: null, outcome: "DIRECTION_APPROVES" },
        ],
      },
    ]);
    // A driver records expenses only.
    expect((await chainOf(t.DRIVER)).chains.map((chain) => chain.commandType)).toEqual([
      "record-expense",
    ]);
    expect((await chainOf(t.DIRECTOR)).chains).toEqual([
      { commandType: "record-expense", steps: [{ upToMinor: null, outcome: "POSTS_DIRECTLY" }] },
      { commandType: "record-revenue", steps: [{ upToMinor: null, outcome: "POSTS_DIRECTLY" }] },
    ]);
    // Finance's own entry goes to a colleague or to Direction, never to themselves.
    expect((await chainOf(t.FINANCE)).chains[0]?.steps).toEqual([
      { upToMinor: 150_000, outcome: "POSTS_DIRECTLY" },
      { upToMinor: 1_000_000, outcome: "FINANCE_PEER_APPROVES" },
      { upToMinor: null, outcome: "DIRECTION_APPROVES" },
    ]);
    expect((await chainOf(t.FINANCE)).currency).toBe("XAF");
  });

  it("moves the Finance ceiling in the chain and tells every recording role", async () => {
    const t = await team();
    await move(t.DIRECTOR, "approve-entry", 500_000);

    const { chains, notice } = await chainOf(t.DRIVER);
    expect(notice).not.toBeNull();
    expect(chains[0]?.steps).toEqual([
      { upToMinor: 100_000, outcome: "POSTS_DIRECTLY" },
      { upToMinor: 500_000, outcome: "FINANCE_APPROVES" },
      { upToMinor: null, outcome: "DIRECTION_APPROVES" },
    ]);
  });

  it("tells only the roles that record revenue about a revenue band", async () => {
    const t = await team();
    await move(t.DIRECTOR, "record-revenue", 300_000);

    for (const role of ["ADMIN", "FINANCE", "CASHIER"] as const) {
      expect((await chainOf(t[role])).notice, role).not.toBeNull();
    }
    for (const role of ["TECHNICIAN", "DRIVER"] as const) {
      expect((await chainOf(t[role])).notice, role).toBeNull();
    }
  });

  it("says nothing about a work-order band: the entry chain did not move", async () => {
    const t = await team();
    await move(t.DIRECTOR, "create-work-order", 200_000);
    expect((await chainOf(t.TECHNICIAN)).notice).toBeNull();
    expect((await chainOf(t.ADMIN)).notice).toBeNull();
  });

  it("records the dismissal per member through the command, and audits it", async () => {
    const t = await team();
    await move(t.DIRECTOR, "record-expense", 150_000);
    const notice = (await chainOf(t.FINANCE)).notice;
    if (notice === null) throw new Error("expected a notice");

    const result = await api.ok(t.FINANCE.token, "acknowledge-approval-rules", {
      changeId: notice.changeId,
    });
    expect((await chainOf(t.FINANCE)).notice).toBeNull();
    // Someone else's acknowledgement is not theirs.
    expect((await chainOf(t.ADMIN)).notice?.changeId).toBe(notice.changeId);

    const [row] = await ctx.db
      .select()
      .from(approvalRuleAcknowledgements)
      .where(eq(approvalRuleAcknowledgements.createdByCommandId, result.commandId));
    expect(row).toMatchObject({
      changeId: notice.changeId,
      membershipId: t.FINANCE.membershipId,
    });

    const [event] = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.commandId, result.commandId));
    expect(event).toMatchObject({
      eventType: "approval-rules.acknowledged",
      entityType: "approval_rule_change",
      entityId: notice.changeId,
      actorPrincipalId: t.FINANCE.principalId,
    });
  });

  it("accepts a second acknowledgement of the same change, as from a second tab, without a second row (#453)", async () => {
    const t = await team();
    await move(t.DIRECTOR, "record-expense", 150_000);
    const notice = (await chainOf(t.FINANCE)).notice;
    if (notice === null) throw new Error("expected a notice");

    // Two tabs, two envelopes: each its own idempotency key.
    const first = await api.ok(t.FINANCE.token, "acknowledge-approval-rules", {
      changeId: notice.changeId,
    });
    const second = await api.send(t.FINANCE.token, "acknowledge-approval-rules", {
      changeId: notice.changeId,
    });
    expect(second.status).toBe(200);
    expect(second.body.recordId).toBe(first.recordId);

    const rows = await ctx.db
      .select()
      .from(approvalRuleAcknowledgements)
      .where(
        and(
          eq(approvalRuleAcknowledgements.changeId, notice.changeId),
          eq(approvalRuleAcknowledgements.membershipId, t.FINANCE.membershipId),
        ),
      );
    expect(rows).toHaveLength(1);
    // Nothing happened the second time, so nothing is audited.
    const events = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.eventType, "approval-rules.acknowledged"),
          eq(auditEvents.entityId, notice.changeId),
          eq(auditEvents.actorPrincipalId, t.FINANCE.principalId),
        ),
      );
    expect(events).toHaveLength(1);
    expect((await chainOf(t.FINANCE)).notice).toBeNull();
  });

  it("tells no one when a threshold update leaves every band where it was (#453)", async () => {
    const t = await team();
    await move(t.DIRECTOR, "record-expense", 150_000);
    await move(t.DIRECTOR, "approve-entry", 500_000);
    const notice = (await chainOf(t.ADMIN)).notice;
    if (notice === null) throw new Error("expected a notice");
    await api.ok(t.ADMIN.token, "acknowledge-approval-rules", { changeId: notice.changeId });

    const changesBefore = await ctx.db
      .select()
      .from(approvalRuleChanges)
      .where(eq(approvalRuleChanges.workspaceId, t.workspaceId));
    await move(t.DIRECTOR, "record-expense", 150_000);
    await move(t.DIRECTOR, "approve-entry", 500_000);
    const changesAfter = await ctx.db
      .select()
      .from(approvalRuleChanges)
      .where(eq(approvalRuleChanges.workspaceId, t.workspaceId));

    expect(changesAfter).toHaveLength(changesBefore.length);
    expect((await chainOf(t.ADMIN)).notice).toBeNull();
    // A member who never acknowledged still sees the one real change.
    expect((await chainOf(t.DRIVER)).notice?.changeId).toBe(notice.changeId);
  });

  it("shows one notice after several changes, for the current rules only", async () => {
    const t = await team();
    await move(t.DIRECTOR, "record-expense", 150_000);
    const first = (await chainOf(t.ADMIN)).notice;
    await move(t.DIRECTOR, "approve-entry", 800_000);
    await move(t.DIRECTOR, "record-expense", 120_000);

    const { notice, chains } = await chainOf(t.ADMIN);
    expect(notice).not.toBeNull();
    expect(notice?.changeId).not.toBe(first?.changeId);
    expect(chains[0]?.steps).toEqual([
      { upToMinor: 120_000, outcome: "POSTS_DIRECTLY" },
      { upToMinor: 800_000, outcome: "FINANCE_APPROVES" },
      { upToMinor: null, outcome: "DIRECTION_APPROVES" },
    ]);

    await api.ok(t.ADMIN.token, "acknowledge-approval-rules", { changeId: notice?.changeId });
    expect((await chainOf(t.ADMIN)).notice).toBeNull();
  });

  it("tells a member who joined after the change nothing: they never knew the old rules", async () => {
    const t = await team();
    await move(t.DIRECTOR, "record-expense", 150_000);
    const newcomer = await seedActor(ctx.db, { workspaceId: t.workspaceId, role: "DRIVER" });
    expect((await chainOf(newcomer)).notice).toBeNull();
  });

  it("keeps other workspaces out: no notice there, and no acknowledging this one's change", async () => {
    const t = await team();
    const other = await team();
    await move(t.DIRECTOR, "record-expense", 150_000);
    const notice = (await chainOf(t.DRIVER)).notice;

    expect((await chainOf(other.DRIVER)).notice).toBeNull();
    const reply = await api.send(other.DRIVER.token, "acknowledge-approval-rules", {
      changeId: notice?.changeId,
    });
    expect(reply.status).toBe(422);
    expect(reply.body.error?.code).toBe("REFERENCE_NOT_FOUND");
  });

  it("names no one for the release that changed the chain (0038), and tells only the roles it moved", async () => {
    const t = await team();
    // What migration 0039 writes: no receipt, so no member to name.
    await ctx.db
      .insert(approvalRuleChanges)
      .values({ workspaceId: t.workspaceId, affectedRoles: ["FINANCE", "ADMIN"] });

    for (const role of ["FINANCE", "ADMIN"] as const) {
      expect((await chainOf(t[role])).notice?.changedBy, role).toBeNull();
    }
    for (const role of ["DIRECTOR", "CASHIER", "TECHNICIAN", "DRIVER"] as const) {
      expect((await chainOf(t[role])).notice, role).toBeNull();
    }
  });

  it("is silent while the Finance module is off: no entries, so no chain to tell", async () => {
    const t = await team();
    await move(t.DIRECTOR, "record-expense", 150_000);
    await api.ok(t.DIRECTOR.token, "disable-module", { moduleCode: "FINANCE" });

    expect(await chainOf(t.ADMIN)).toEqual({ currency: "XAF", chains: [], notice: null });
  });
});
