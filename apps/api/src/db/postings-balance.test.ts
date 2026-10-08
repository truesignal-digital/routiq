import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { currentPeriodCode } from "../commands/periods.js";
import { inWorkspace } from "./tenant.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

/** §3.4 as a database fact: an entry's postings sum to its amount, checked at commit (0031). */
describe("financial entry balance trigger", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  let entryId: string;
  let token: string;
  const economicDate = `${currentPeriodCode(new Date(), "Africa/Douala")}-15`;

  const command = (name: string, payload: Record<string, unknown>, expectedVersion?: number) =>
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

  const balance = async (id: string) =>
    ((await ctx.db.execute(sql`
      select e.amount_minor::text as amount, count(p.id)::int as lines, sum(p.amount_minor)::text as posted
      from financial_entries e join financial_postings p on p.financial_entry_id = e.id
      where e.id = ${id} group by e.amount_minor
    `)).rows as { amount: string; lines: number; posted: string }[])[0];

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
    const admin = await seedMember(ctx.db, { workspaceId, role: "DIRECTOR", allBranches: true });
    ({ token } = await createSession(ctx.db, { principalId: admin.principal.id, workspaceId }));
    entryId = randomUUID();
    const response = await command("record-expense", {
      entryId, branchCode: "DLA", categoryCode: "FUEL", economicDate,
      amountMinor: 25000, paymentMethod: "CASH", postings: [{ amountMinor: 25000 }],
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

  it("lets the command path commit an entry split over several lines", async () => {
    const splitId = randomUUID();
    const response = await command("record-expense", {
      entryId: splitId, branchCode: "DLA", categoryCode: "FUEL", economicDate,
      amountMinor: 30000, paymentMethod: "CASH",
      postings: [{ amountMinor: 12000 }, { amountMinor: 10000 }, { amountMinor: 8000 }],
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(await balance(splitId)).toEqual({ amount: "30000", lines: 3, posted: "30000" });
  });

  it("lets a reversal commit, its negative lines summing to its negative amount", async () => {
    const originalId = randomUUID();
    const recorded = await command("record-expense", {
      entryId: originalId, branchCode: "DLA", categoryCode: "FUEL", economicDate,
      amountMinor: 18000, paymentMethod: "CASH", postings: [{ amountMinor: 11000 }, { amountMinor: 7000 }],
    });
    expect(recorded.statusCode, recorded.body).toBe(200);
    expect(recorded.json()).toMatchObject({ recordStatus: "POSTED" });

    const reversalId = randomUUID();
    const reversed = await command(
      "reverse-entry",
      { reversalEntryId: reversalId, originalEntryId: originalId, reason: "saisie en double" },
      1,
    );
    expect(reversed.statusCode, reversed.body).toBe(200);
    expect(await balance(reversalId)).toEqual({ amount: "-18000", lines: 2, posted: "-18000" });
  });

  it("refuses at commit a new entry whose only line disagrees with it", async () => {
    const strayId = randomUUID();
    const attempt = inWorkspace(ctx.runtimeDb, workspaceId, async (tx) => {
      await tx.execute(sql`
        insert into financial_entries
        select * from jsonb_populate_record(null::financial_entries, (
          select to_jsonb(e) || jsonb_build_object('id', ${strayId}::uuid, 'entry_number', ${`STRAY-${strayId.slice(0, 8)}`}::text, 'amount_minor', 40000::bigint)
          from financial_entries e where e.workspace_id = ${workspaceId}::uuid and e.id = ${entryId}::uuid
        ))
      `);
      await tx.execute(sql`
        insert into financial_postings
        select * from jsonb_populate_record(null::financial_postings, (
          select to_jsonb(p) || jsonb_build_object('id', gen_random_uuid(), 'financial_entry_id', ${strayId}::uuid, 'amount_minor', 39000::bigint)
          from financial_postings p
          where p.workspace_id = ${workspaceId}::uuid and p.financial_entry_id = ${entryId}::uuid
          order by p.line_no limit 1
        ))
      `);
    });
    await expect(attempt).rejects.toSatisfy((error: unknown) =>
      /postings summing to 39000, not its amount 40000/.test(String((error as { cause?: unknown }).cause ?? error)),
    );
    const left = (await ctx.db.execute(sql`select 1 from financial_entries where id = ${strayId}`)).rows;
    expect(left).toEqual([]);
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
