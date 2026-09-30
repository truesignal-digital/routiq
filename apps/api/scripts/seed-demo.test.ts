import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

/**
 * The demo seed as the demo box runs it: a child process against a real
 * Postgres, twice. Business keys (slug, usernames, asset codes) rather than the
 * seed's deterministic ids, so the test reads what an operator would see.
 */

const run = promisify(execFile);
const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const tsx = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));

interface SeedRun {
  stdout: string;
  stderr: string;
}

function seedEnv(): NodeJS.ProcessEnv {
  const ownerUrl = inject("databaseUrl");
  const runtimeUrl = new URL(ownerUrl);
  runtimeUrl.username = "routiq_app";
  runtimeUrl.password = "routiq_app";
  return { ...process.env, DATABASE_URL: runtimeUrl.toString(), AUTH_DATABASE_URL: ownerUrl };
}

/** Rejects, with the seed's output, when it exits non-zero. */
async function runSeed(...args: string[]): Promise<SeedRun> {
  return run(tsx, ["scripts/seed-demo.ts", ...args], {
    cwd: apiRoot,
    env: seedEnv(),
    timeout: 150_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function summaryOf(output: string): {
  accounts: Array<{ username: string; role: string }>;
  vehicleWorkspace: { VH003: { groundedSince: string | null; pendingAmountMinor: string } };
} {
  return JSON.parse(output.slice(output.indexOf("\n{") + 1));
}

const WORKSPACE_TABLES = [
  "commands",
  "audit_events",
  "memberships",
  "credentials",
  "branches",
  "categories",
  "assets",
  "financial_entries",
  "financial_postings",
  "meter_readings",
  "documents",
  "notes",
  "operational_issues",
  "work_orders",
  "asset_availability_intervals",
] as const;

describe("seed-demo", () => {
  let client: pg.Client;
  let first: SeedRun;
  let second: SeedRun;
  let countsAfterFirst: Record<string, number>;
  let countsAfterSecond: Record<string, number>;
  let workspaceId: string;

  async function rows<T>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await client.query(text, values)).rows as T[];
  }

  async function counts(): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    // One client, so one query at a time.
    for (const table of WORKSPACE_TABLES) {
      const [row] = await rows<{ n: number }>(
        `select count(*)::int as n from ${table} where workspace_id = $1`,
        [workspaceId],
      );
      result[table] = row!.n;
    }
    return result;
  }

  async function assetId(code: string): Promise<string> {
    const [row] = await rows<{ id: string }>(
      "select id from assets where workspace_id = $1 and asset_code = $2",
      [workspaceId, code],
    );
    return row!.id;
  }

  beforeAll(async () => {
    client = new pg.Client({ connectionString: inject("databaseUrl") });
    await client.connect();

    first = await runSeed();
    const [workspace] = await rows<{ id: string }>(
      "select id from workspaces where slug = 'transports-ngwa'",
    );
    workspaceId = workspace!.id;
    countsAfterFirst = await counts();

    second = await runSeed();
    countsAfterSecond = await counts();
  }, 320_000);

  afterAll(async () => {
    await client.end();
  });

  it("gives every role a login, with Patrice scoped to Yaoundé", async () => {
    const accounts = await rows<{ username: string; role: string; scope: string }>(
      `select c.username, m.role,
              case when m.all_branches then 'ALL'
                   else (select string_agg(b.code, ',' order by b.code) from branches b
                         where b.workspace_id = m.workspace_id and b.id = any(m.branch_ids))
              end as scope
         from memberships m
         join credentials c on c.workspace_id = m.workspace_id and c.principal_id = m.principal_id
        where m.workspace_id = $1
        order by c.username`,
      [workspaceId],
    );
    expect(accounts).toEqual([
      { username: "amadou", role: "EXECUTIVE_VIEWER", scope: "ALL" },
      { username: "boris", role: "OPS_MANAGER", scope: "ALL" },
      { username: "emilienne", role: "ADMIN", scope: "ALL" },
      { username: "herve", role: "MAINTENANCE", scope: "ALL" },
      { username: "nadege", role: "FINANCE_APPROVER", scope: "ALL" },
      { username: "patrice", role: "FIELD_SUBMITTER", scope: "YDE" },
      { username: "sali", role: "FIELD_SUBMITTER", scope: "ALL" },
    ]);
  });

  it("registers VH003 under its plate and puts both trucks in service", async () => {
    const trucks = await rows<{
      code: string;
      plate: string | null;
      status: string;
      commissioned: boolean;
    }>(
      `select asset_code as code, registration_number as plate, lifecycle_status as status,
              commissioned_at is not null as commissioned
         from assets where workspace_id = $1 and asset_code in ('VH001', 'VH003')
        order by asset_code`,
      [workspaceId],
    );
    expect(trucks).toEqual([
      { code: "VH001", plate: null, status: "IN_SERVICE", commissioned: true },
      { code: "VH003", plate: "LT 482 AB", status: "IN_SERVICE", commissioned: true },
    ]);
  });

  it("grounds VH003 behind an approved brake work order with one cost line awaiting review", async () => {
    const vh003 = await assetId("VH003");

    const open = await rows<{ category: string }>(
      `select i.category from asset_availability_intervals a
         join operational_issues i on i.workspace_id = a.workspace_id and i.id = a.opened_by_issue_id
        where a.workspace_id = $1 and a.asset_id = $2 and a.closed_at is null`,
      [workspaceId, vh003],
    );
    expect(open).toEqual([{ category: "BRAKES" }]);

    const orders = await rows<{ id: string; status: string; expected: string }>(
      `select id, status, expected_cost_minor::text as expected from work_orders
        where workspace_id = $1 and asset_id = $2`,
      [workspaceId, vh003],
    );
    expect(orders.map(({ status, expected }) => ({ status, expected }))).toEqual([
      { status: "APPROVED", expected: "450000" },
    ]);

    const costLines = await rows<{ amount: string; status: string }>(
      `select p.amount_minor::text as amount, e.status from financial_postings p
         join financial_entries e on e.workspace_id = p.workspace_id and e.id = p.financial_entry_id
        where p.workspace_id = $1 and p.work_order_id = $2`,
      [workspaceId, orders[0]!.id],
    );
    expect(costLines).toEqual([{ amount: "310000", status: "SUBMITTED" }]);

    const issues = await rows<{ category: string; safety_critical: boolean; status: string }>(
      `select category, safety_critical, status from operational_issues
        where workspace_id = $1 and asset_id = $2 order by reported_at`,
      [workspaceId, vh003],
    );
    expect(issues).toEqual([
      { category: "BRAKES", safety_critical: true, status: "OPEN" },
      { category: "BODYWORK", safety_critical: false, status: "OPEN" },
    ]);
  });

  it("files VH003's papers in the four states: expired, expiring, valid and no expiry", async () => {
    const vh003 = await assetId("VH003");
    const documents = await rows<{
      type: string;
      days_left: number | null;
      renews_one: boolean;
    }>(
      `select d.document_type_code as type,
              d.expires_at - (now() at time zone 'Africa/Douala')::date as days_left,
              d.supersedes_document_id is not null as renews_one
         from documents d
        where d.workspace_id = $1 and d.asset_id = $2
          and not exists (select 1 from documents s
                           where s.workspace_id = d.workspace_id and s.supersedes_document_id = d.id)
        order by d.document_type_code`,
      [workspaceId, vh003],
    );
    expect(documents).toEqual([
      { type: "INSURANCE", days_left: 12, renews_one: false },
      { type: "PERMIT", days_left: 400, renews_one: false },
      { type: "REGISTRATION", days_left: null, renews_one: false },
      { type: "TECHNICAL_INSPECTION", days_left: -3, renews_one: true },
    ]);
  });

  it("closes VH001's A/C job: completed work order, resolved issue, no grounding", async () => {
    const vh001 = await assetId("VH001");
    const orders = await rows<{ status: string; actual: string }>(
      `select status, actual_cost_minor::text as actual from work_orders
        where workspace_id = $1 and asset_id = $2`,
      [workspaceId, vh001],
    );
    expect(orders).toEqual([{ status: "COMPLETED", actual: "85000" }]);
    const issues = await rows<{ status: string }>(
      "select status from operational_issues where workspace_id = $1 and asset_id = $2",
      [workspaceId, vh001],
    );
    expect(issues).toEqual([{ status: "RESOLVED" }]);
    const open = await rows(
      `select 1 from asset_availability_intervals
        where workspace_id = $1 and asset_id = $2 and closed_at is null`,
      [workspaceId, vh001],
    );
    expect(open).toEqual([]);
  });

  it("prints the accounts and VH003's state in its summary", () => {
    const summary = summaryOf(first.stdout);
    expect(summary.accounts.map((account) => account.username)).toHaveLength(7);
    expect(summary.vehicleWorkspace.VH003.groundedSince).not.toBeNull();
    // Hervé's brake parts plus Sali's July repair, both awaiting the approver.
    expect(summary.vehicleWorkspace.VH003.pendingAmountMinor).toBe("760000");
  });

  it("replays cleanly the second time: same rows, nothing skipped", () => {
    expect(countsAfterSecond).toEqual(countsAfterFirst);
    expect(countsAfterFirst["notes"]).toBe(1);
    expect(second.stdout).toContain("Already provisioned");
    expect(second.stderr).not.toContain("Skipped");
    expect(summaryOf(second.stdout)).toEqual(summaryOf(first.stdout));
  });
});

describe("seed-demo --reset on a populated database (#128)", () => {
  let owner: pg.Client;
  let reset: SeedRun;
  let countsBefore: Record<string, number>;
  let countsAfter: Record<string, number>;

  async function workspaceId(): Promise<string> {
    const { rows } = await owner.query<{ id: string }>(
      "select id from workspaces where slug = 'transports-ngwa'",
    );
    return rows[0]!.id;
  }

  async function counts(id: string): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const table of WORKSPACE_TABLES) {
      const { rows } = await owner.query<{ n: number }>(
        `select count(*)::int as n from ${table} where workspace_id = $1`,
        [id],
      );
      result[table] = rows[0]!.n;
    }
    return result;
  }

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: inject("databaseUrl") });
    await owner.connect();
    // The suite above leaves the demo seeded, posted lines included.
    countsBefore = await counts(await workspaceId());
    reset = await runSeed("--reset");
    countsAfter = await counts(await workspaceId());
  }, 200_000);

  afterAll(async () => {
    await owner.end();
  });

  it("deletes the populated workspace and seeds it again", () => {
    expect(countsBefore["financial_postings"]).toBeGreaterThan(0);
    expect(reset.stdout).toContain("Reset: deleted existing workspace");
    expect(countsAfter).toEqual(countsBefore);
  });

  it("leaves the posting delete guards switched on", async () => {
    const { rows } = await owner.query<{ name: string; enabled: string }>(
      `select tgname as name, tgenabled as enabled from pg_trigger
        where tgrelid = 'financial_postings'::regclass
          and tgname in ('financial_postings_pending_delete', 'financial_postings_balance_on_delete')
        order by tgname`,
    );
    expect(rows).toEqual([
      { name: "financial_postings_balance_on_delete", enabled: "O" },
      { name: "financial_postings_pending_delete", enabled: "O" },
    ]);
  });

  it("still refuses the app role deleting a posted entry's lines", async () => {
    const id = await workspaceId();
    const { rows: posted } = await owner.query<{ entryId: string }>(
      `select e.id as "entryId" from financial_entries e
        where e.workspace_id = $1 and e.status = 'POSTED'
          and exists (select 1 from financial_postings p
                       where p.workspace_id = e.workspace_id and p.financial_entry_id = e.id)
        limit 1`,
      [id],
    );
    expect(posted).toHaveLength(1);
    const entryId = posted[0]!.entryId;

    const app = new pg.Client({ connectionString: seedEnv()["DATABASE_URL"] });
    await app.connect();
    try {
      await app.query("begin");
      await app.query("select set_config('app.workspace_id', $1, true)", [id]);
      await expect(
        app.query("delete from financial_postings where workspace_id = $1 and financial_entry_id = $2", [
          id,
          entryId,
        ]),
      ).rejects.toThrow(/removable only from a pending entry/);
      await app.query("rollback");
    } finally {
      await app.end();
    }

    const { rows: lines } = await owner.query(
      "select 1 from financial_postings where workspace_id = $1 and financial_entry_id = $2",
      [id, entryId],
    );
    expect(lines.length).toBeGreaterThan(0);
  });
});
