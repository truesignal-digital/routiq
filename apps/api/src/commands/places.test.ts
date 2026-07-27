import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commands, places } from "../db/schema.js";
import { inWorkspace } from "../db/tenant.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import type { CommandContext } from "./dispatcher.js";
import { normalizePlaceName, resolveOrCreatePlace } from "./places.js";

describe("place resolution", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  let commandId: string;
  let commandCtx: CommandContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    const member = await seedMember(ctx.db, {
      workspaceId,
      role: "OPS_MANAGER",
      allBranches: true,
    });

    commandId = randomUUID();
    await ctx.db.insert(commands).values({
      id: commandId,
      workspaceId,
      commandType: "places-test",
      origin: "API",
      status: "EXECUTED",
      initiatedByPrincipalId: member.principal.id,
      idempotencyKey: `idem-${randomUUID()}`,
      payload: {},
    });

    commandCtx = {
      workspaceId,
      principalId: member.principal.id,
      principalType: "HUMAN",
      membershipId: member.membership.id,
      role: "OPS_MANAGER",
      branchScope: "ALL",
    } as CommandContext;
  });

  afterAll(async () => {
    await ctx.close();
  });

  function resolve(name: string, placeId = randomUUID()): Promise<string> {
    return inWorkspace(ctx.db, workspaceId, (tx) =>
      resolveOrCreatePlace(tx, commandCtx, { placeId, name }, commandId),
    );
  }

  it("normalizes the way clerks actually type", () => {
    expect(normalizePlaceName("  Douala ")).toBe("douala");
    expect(normalizePlaceName("NGAOUNDÉRÉ")).toBe("ngaoundéré");
    expect(normalizePlaceName("Garoua  Boulaï")).toBe("garoua boulaï");
  });

  it("registers a place the first time it is named", async () => {
    const id = await resolve("Meiganga");
    const [row] = await ctx.db.select().from(places).where(eq(places.id, id));
    expect(row).toMatchObject({ name: "Meiganga", normalizedName: "meiganga" });
  });

  it("returns the same place for a differently-typed name", async () => {
    const first = await resolve("Bertoua");
    const second = await resolve("  bertoua ");
    expect(second).toBe(first);
  });

  /**
   * The property the whole no-command design rests on: an offline envelope
   * replayed days later carries a place id that may have lost the race, and
   * must still land on the row that won.
   */
  it("survives replay when the client's proposed id lost", async () => {
    const losingId = randomUUID();
    const winner = await resolve("Kribi");
    const replayed = await resolve("Kribi", losingId);

    expect(replayed).toBe(winner);
    expect(replayed).not.toBe(losingId);

    const rows = await ctx.db
      .select()
      .from(places)
      .where(eq(places.normalizedName, "kribi"));
    expect(rows).toHaveLength(1);
  });
});
