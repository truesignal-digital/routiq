import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { assertResettable } from "./seed-demo-slugs.js";

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

interface SeedSummary {
  "transports-ngwa": {
    accounts: Array<{ username: string; role: string }>;
    vehicleWorkspace: { VH003: { groundedSince: string | null; pendingAmountMinor: string } };
  };
  "littoral-voyages": {
    accounts: Array<{ username: string; role: string }>;
    vehicles: Array<{ registrationNumber: string; seatCount: number }>;
    entries: Array<{ amountMinor: string; status: string }>;
  };
}

function summaryOf(output: string): SeedSummary {
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
  let littoralCountsAfterFirst: Record<string, number>;
  let littoralCountsAfterSecond: Record<string, number>;
  let workspaceId: string;
  let littoralId: string;

  async function rows<T>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await client.query(text, values)).rows as T[];
  }

  async function counts(id = workspaceId): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    // One client, so one query at a time.
    for (const table of WORKSPACE_TABLES) {
      const [row] = await rows<{ n: number }>(
        `select count(*)::int as n from ${table} where workspace_id = $1`,
        [id],
      );
      result[table] = row!.n;
    }
    return result;
  }

  async function assetId(code: string, id = workspaceId): Promise<string> {
    const [row] = await rows<{ id: string }>(
      "select id from assets where workspace_id = $1 and asset_code = $2",
      [id, code],
    );
    return row!.id;
  }

  async function workspaceIdOf(slug: string): Promise<string> {
    const [workspace] = await rows<{ id: string }>("select id from workspaces where slug = $1", [
      slug,
    ]);
    return workspace!.id;
  }

  beforeAll(async () => {
    client = new pg.Client({ connectionString: inject("databaseUrl") });
    await client.connect();

    first = await runSeed();
    workspaceId = await workspaceIdOf("transports-ngwa");
    littoralId = await workspaceIdOf("littoral-voyages");
    countsAfterFirst = await counts();
    littoralCountsAfterFirst = await counts(littoralId);

    second = await runSeed();
    countsAfterSecond = await counts();
    littoralCountsAfterSecond = await counts(littoralId);
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
      { username: "amadou", role: "ADMIN", scope: "YDE" },
      { username: "boris", role: "ADMIN", scope: "ALL" },
      { username: "clarisse", role: "CASHIER", scope: "DLA" },
      { username: "emilienne", role: "DIRECTOR", scope: "ALL" },
      { username: "herve", role: "TECHNICIAN", scope: "ALL" },
      { username: "nadege", role: "FINANCE", scope: "ALL" },
      { username: "patrice", role: "DRIVER", scope: "YDE" },
      { username: "sali", role: "DRIVER", scope: "ALL" },
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
    const orders = await rows<{ status: string; outcome: string; declared: string | null }>(
      `select status, cost_outcome as outcome, declared_cost_minor::text as declared
         from work_orders
        where workspace_id = $1 and asset_id = $2`,
      [workspaceId, vh001],
    );
    // The cost is the A/C entry already in the books; nothing is typed at close.
    expect(orders).toEqual([{ status: "COMPLETED", outcome: "LINES", declared: null }]);
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
    const summary = summaryOf(first.stdout)["transports-ngwa"];
    expect(summary.accounts.map((account) => account.username)).toHaveLength(8);
    expect(summary.vehicleWorkspace.VH003.groundedSince).not.toBeNull();
    // Hervé's brake parts plus Sali's July repair, both awaiting the approver.
    expect(summary.vehicleWorkspace.VH003.pendingAmountMinor).toBe("760000");
  });

  describe("littoral-voyages, the passenger company", () => {
    it("is a PASSENGER_TRANSPORT workspace in XAF with Douala and Yaoundé", async () => {
      const [workspace] = await rows<{ name: string; currency: string; locale: string; timezone: string }>(
        `select name, default_currency as currency, default_locale as locale, timezone
           from workspaces where id = $1`,
        [littoralId],
      );
      expect(workspace).toEqual({
        name: "Littoral Voyages",
        currency: "XAF",
        locale: "fr-CM",
        timezone: "Africa/Douala",
      });
      const templates = await rows<{ code: string }>(
        "select preset_code as code from workspace_templates where workspace_id = $1 and enabled order by 1",
        [littoralId],
      );
      expect(templates.map(({ code }) => code)).toEqual(["PASSENGER_TRANSPORT"]);
      const branches = await rows<{ code: string; name: string }>(
        "select code, name from branches where workspace_id = $1 order by code",
        [littoralId],
      );
      expect(branches).toEqual([
        { code: "DLA", name: "Douala" },
        { code: "YDE", name: "Yaoundé" },
      ]);
    });

    it("gives each of the six roles a login, with Grace scoped to Douala", async () => {
      const accounts = await rows<{ username: string; role: string; scope: string; name: string }>(
        `select c.username, m.role, p.display_name as name,
                case when m.all_branches then 'ALL'
                     else (select string_agg(b.code, ',' order by b.code) from branches b
                           where b.workspace_id = m.workspace_id and b.id = any(m.branch_ids))
                end as scope
           from memberships m
           join principals p on p.id = m.principal_id
           join credentials c on c.workspace_id = m.workspace_id and c.principal_id = m.principal_id
          where m.workspace_id = $1
          order by c.username`,
        [littoralId],
      );
      expect(accounts).toEqual([
        { username: "aline", role: "FINANCE", name: "Aline Mbappe", scope: "ALL" },
        { username: "bertrand", role: "TECHNICIAN", name: "Bertrand Nkeng", scope: "ALL" },
        { username: "eric", role: "DRIVER", name: "Éric Tchoua", scope: "ALL" },
        { username: "grace", role: "CASHIER", name: "Grace Ebode", scope: "DLA" },
        { username: "josiane", role: "DIRECTOR", name: "Josiane Ndongo", scope: "ALL" },
        { username: "paul", role: "ADMIN", name: "Paul Essomba", scope: "ALL" },
      ]);
    });

    it("puts three passenger vehicles in service, each with its seat count", async () => {
      const vehicles = await rows<{
        plate: string;
        template: string;
        seats: number;
        branch: string;
        status: string;
      }>(
        `select a.registration_number as plate, a.template_code as template,
                (a.custom_values->>'seatCount')::int as seats, b.code as branch,
                a.lifecycle_status as status
           from assets a join branches b on b.workspace_id = a.workspace_id and b.id = a.branch_id
          where a.workspace_id = $1
          order by seats desc`,
        [littoralId],
      );
      expect(vehicles).toEqual([
        { plate: "LT 731 CE", template: "PASSENGER_TRANSPORT", seats: 70, branch: "DLA", status: "IN_SERVICE" },
        { plate: "CE 214 LT", template: "PASSENGER_TRANSPORT", seats: 30, branch: "DLA", status: "IN_SERVICE" },
        { plate: "CE 908 YD", template: "PASSENGER_TRANSPORT", seats: 22, branch: "YDE", status: "IN_SERVICE" },
      ]);
    });

    it("closes one Douala–Yaoundé voyage complete, with tickets, fuel and tolls posted, and keeps one on the road", async () => {
      const voyages = await rows<{ plate: string; status: string; completeness: string | null }>(
        `select a.registration_number as plate, v.status, v.completeness
           from activities v
           join categories t on t.workspace_id = v.workspace_id and t.id = v.activity_type_id
           join activity_asset_segments g
             on g.workspace_id = v.workspace_id and g.activity_id = v.id and g.role = 'PRIMARY'
           join assets a on a.workspace_id = g.workspace_id and a.id = g.asset_id
          where v.workspace_id = $1 and t.code = 'SCHEDULED_JOURNEY'
          order by v.started_at`,
        [littoralId],
      );
      expect(voyages).toEqual([
        { plate: "LT 731 CE", status: "CLOSED", completeness: "COMPLETE" },
        { plate: "CE 214 LT", status: "OPEN", completeness: null },
      ]);

      const closedLines = await rows<{ category: string; amount: string; status: string }>(
        `select c.code as category, p.amount_minor::text as amount, e.status
           from financial_postings p
           join financial_entries e on e.workspace_id = p.workspace_id and e.id = p.financial_entry_id
           join categories c on c.workspace_id = e.workspace_id and c.id = e.category_id
           join activities v on v.workspace_id = p.workspace_id and v.id = p.activity_id
          where p.workspace_id = $1 and v.status = 'CLOSED'
          order by c.code`,
        [littoralId],
      );
      expect(closedLines).toEqual([
        { category: "FUEL", amount: "92400", status: "POSTED" },
        { category: "TICKET_REVENUE", amount: "384000", status: "POSTED" },
        { category: "TOLLS", amount: "5000", status: "POSTED" },
      ]);
    });

    it("lands entries in every approval band, recorded by the role that handles them", async () => {
      const entries = await rows<{ category: string; amount: string; status: string; recorder: string }>(
        `select c.code as category, e.amount_minor::text as amount, e.status, cr.username as recorder
           from financial_entries e
           join categories c on c.workspace_id = e.workspace_id and c.id = e.category_id
           join commands k on k.workspace_id = e.workspace_id and k.id = e.created_by_command_id
           join credentials cr on cr.workspace_id = k.workspace_id and cr.principal_id = k.initiated_by_principal_id
          where e.workspace_id = $1
          order by e.amount_minor`,
        [littoralId],
      );
      expect(entries).toEqual([
        { category: "TOLLS", amount: "5000", status: "POSTED", recorder: "eric" },
        { category: "FUEL", amount: "58800", status: "POSTED", recorder: "eric" },
        { category: "FUEL", amount: "92400", status: "POSTED", recorder: "eric" },
        { category: "TICKET_REVENUE", amount: "162000", status: "SUBMITTED", recorder: "grace" },
        { category: "REPAIRS", amount: "185000", status: "SUBMITTED", recorder: "bertrand" },
        { category: "TICKET_REVENUE", amount: "384000", status: "POSTED", recorder: "grace" },
        { category: "INSURANCE", amount: "1850000", status: "SUBMITTED", recorder: "paul" },
      ]);
      // Up to 100 000 posts at once; up to 1 000 000 waits for Finance; above, for Direction.
      const waiting = entries.filter((entry) => entry.status === "SUBMITTED").map((entry) => Number(entry.amount));
      expect(waiting.filter((amount) => amount > 100_000 && amount <= 1_000_000)).toHaveLength(2);
      expect(waiting.filter((amount) => amount > 1_000_000)).toHaveLength(1);
    });

    it("leaves exactly one entry with its receipt missing: the road voyage's cash fuel", async () => {
      const missing = await rows<{ category: string; amount: string }>(
        `select c.code as category, e.amount_minor::text as amount
           from financial_entries e
           join categories c on c.workspace_id = e.workspace_id and c.id = e.category_id
          where e.workspace_id = $1 and c.evidence_policy = 'RECEIPT_EXPECTED'
            and (e.payment_reference is null or e.payment_method not in ('MOMO', 'OM', 'BANK'))
            and not exists (select 1 from command_source_artifacts a
                             where a.workspace_id = e.workspace_id and a.command_id = e.created_by_command_id)`,
        [littoralId],
      );
      expect(missing).toEqual([{ category: "FUEL", amount: "58800" }]);
    });

    it("grounds the minibus behind an approved steering work order with its cost pending, and notes the Coaster's door unplanned", async () => {
      const minibus = await assetId("LV-MIN-03", littoralId);
      const open = await rows<{ category: string }>(
        `select i.category from asset_availability_intervals a
           join operational_issues i on i.workspace_id = a.workspace_id and i.id = a.opened_by_issue_id
          where a.workspace_id = $1 and a.asset_id = $2 and a.closed_at is null`,
        [littoralId, minibus],
      );
      expect(open).toEqual([{ category: "STEERING" }]);
      const orders = await rows<{ id: string; status: string; expected: string }>(
        `select id, status, expected_cost_minor::text as expected from work_orders
          where workspace_id = $1 and asset_id = $2`,
        [littoralId, minibus],
      );
      expect(orders.map(({ status, expected }) => ({ status, expected }))).toEqual([
        { status: "APPROVED", expected: "240000" },
      ]);
      const costLines = await rows<{ amount: string; status: string }>(
        `select p.amount_minor::text as amount, e.status from financial_postings p
           join financial_entries e on e.workspace_id = p.workspace_id and e.id = p.financial_entry_id
          where p.workspace_id = $1 and p.work_order_id = $2`,
        [littoralId, orders[0]!.id],
      );
      expect(costLines).toEqual([{ amount: "185000", status: "SUBMITTED" }]);

      const coaster = await assetId("LV-COA-02", littoralId);
      const issues = await rows<{ category: string; safety: boolean; status: string; orders: number }>(
        `select i.category, i.safety_critical as safety, i.status,
                (select count(*)::int from work_orders w
                  where w.workspace_id = i.workspace_id and w.issue_id = i.id) as orders
           from operational_issues i where i.workspace_id = $1 and i.asset_id = $2`,
        [littoralId, coaster],
      );
      expect(issues).toEqual([{ category: "BODYWORK", safety: false, status: "OPEN", orders: 0 }]);
    });

    it("keeps its records in its own workspace", async () => {
      const crossTenant = await rows<{ n: number }>(
        `select count(*)::int as n from financial_postings p
           join assets a on a.id = p.asset_id
          where (p.workspace_id = $1) <> (a.workspace_id = $1)`,
        [littoralId],
      );
      expect(crossTenant).toEqual([{ n: 0 }]);
    });

    it("prints its accounts, vehicles and entries in the summary", () => {
      const summary = summaryOf(first.stdout)["littoral-voyages"];
      expect(summary.accounts).toHaveLength(6);
      expect(summary.vehicles.map((vehicle) => vehicle.seatCount)).toEqual([70, 30, 22]);
      expect(summary.entries).toHaveLength(7);
    });
  });

  it("replays cleanly the second time: same rows in both workspaces, nothing skipped", () => {
    expect(countsAfterSecond).toEqual(countsAfterFirst);
    expect(littoralCountsAfterSecond).toEqual(littoralCountsAfterFirst);
    expect(second.stdout).toContain("Already provisioned: workspace id=" + littoralId);
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
  let littoralBefore: Record<string, number>;
  let littoralAfter: Record<string, number>;

  async function workspaceId(slug = "transports-ngwa"): Promise<string> {
    const { rows } = await owner.query<{ id: string }>(
      "select id from workspaces where slug = $1",
      [slug],
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
    // A rules change a member acknowledged (#422) holds FKs into commands
    // and memberships, which the reset deletes after it.
    const id = await workspaceId();
    await owner.query(
      `with cmd as (select id from commands where workspace_id = $1 limit 1),
            member as (select id from memberships where workspace_id = $1 limit 1),
            change as (
              insert into approval_rule_changes (workspace_id, affected_roles, created_by_command_id)
              select $1, array['FINANCE'], cmd.id from cmd returning id
            )
       insert into approval_rule_acknowledgements (workspace_id, change_id, membership_id, created_by_command_id)
       select $1, change.id, member.id, cmd.id from change, member, cmd`,
      [id],
    );
    countsBefore = await counts(id);
    littoralBefore = await counts(await workspaceId("littoral-voyages"));
    reset = await runSeed("--reset");
    countsAfter = await counts(await workspaceId());
    littoralAfter = await counts(await workspaceId("littoral-voyages"));
  }, 200_000);

  afterAll(async () => {
    await owner.end();
  });

  it("deletes both populated demo workspaces and seeds them again", () => {
    expect(countsBefore["financial_postings"]).toBeGreaterThan(0);
    expect(littoralBefore["financial_postings"]).toBeGreaterThan(0);
    expect(reset.stdout).toContain("Reset: deleted existing workspace transports-ngwa");
    expect(reset.stdout).toContain("Reset: deleted existing workspace littoral-voyages");
    expect(countsAfter).toEqual(countsBefore);
    expect(littoralAfter).toEqual(littoralBefore);
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

describe("assertResettable", () => {
  it("allows the two demo workspaces and refuses any other", () => {
    expect(() => assertResettable("transports-ngwa")).not.toThrow();
    expect(() => assertResettable("littoral-voyages")).not.toThrow();
    expect(() => assertResettable("acme-fleet")).toThrow(/Refusing to reset workspace "acme-fleet"/);
    expect(() => assertResettable("")).toThrow(/Refusing/);
  });
});
