import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { inWorkspace } from "./tenant.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

/** §3.4 as a database fact: an entry's postings sum to its amount, checked at commit (0026). */
describe("financial entry balance trigger", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  let entryId: string;

  /** Adds a copy of the entry's first posting with a new amount, the way a careless script would. */
  const extraPosting = (amountMinor: number, lineNo: number) => sql`
    insert into financial_postings
    select * from jsonb_populate_record(null::financial_postings, (
      select to_jsonb(p) || jsonb_build_object('id', gen_random_uuid(), 'line_no', ${lineNo}::int, 'amount_minor', ${amountMinor}::bigint)
      from financial_postings p
      where p.workspace_id = ${workspaceId}::uuid and p.financial_entry_id = ${entryId}::uuid
      order by p.line_no
      limit 1
    ))
  `;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    const admin = await seedMember(ctx.db, { workspaceId, role: "ADMIN", allBranches: true });
    const { token } = await createSession(ctx.db, { principalId: admin.principal.id, workspaceId });
    entryId = randomUUID();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/record-expense",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        envelope: { commandId: randomUUID(), idempotencyKey: randomUUID(), origin: "HUMAN_UI" },
        payload: {
          entryId, branchCode: "DLA", categoryCode: "FUEL", economicDate: "2026-09-04",
          amountMinor: 25000, paymentMethod: "CASH", postings: [{ amountMinor: 25000 }],
        },
      },
    });
    expect(response.statusCode, response.body).toBe(200);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it("lets the command path commit a balanced entry", async () => {
    const [row] = (await ctx.db.execute(sql`
      select e.amount_minor::text as amount, sum(p.amount_minor)::text as posted
      from financial_entries e join financial_postings p on p.financial_entry_id = e.id
      where e.id = ${entryId} group by e.amount_minor
    `)).rows as { amount: string; posted: string }[];
    expect(row).toEqual({ amount: "25000", posted: "25000" });
  });

  it("refuses at commit a posting that unbalances the entry", async () => {
    const attempt = inWorkspace(ctx.runtimeDb, workspaceId, (tx) => tx.execute(extraPosting(1, 90)));
    await expect(attempt).rejects.toSatisfy((error: unknown) =>
      /postings summing to 25001, not its amount 25000/.test(String((error as { cause?: unknown }).cause ?? error)),
    );
  });

  it("checks at commit, not per row: lines that cancel out may be written one by one", async () => {
    await inWorkspace(ctx.runtimeDb, workspaceId, async (tx) => {
      await tx.execute(extraPosting(1, 91));
      await tx.execute(extraPosting(-1, 92));
    });
    const [row] = (await ctx.db.execute(sql`
      select count(*)::int as lines, sum(amount_minor)::text as posted
      from financial_postings where financial_entry_id = ${entryId}
    `)).rows as { lines: number; posted: string }[];
    expect(row).toEqual({ lines: 3, posted: "25000" });
  });
});
