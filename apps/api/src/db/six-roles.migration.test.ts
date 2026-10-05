import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { corePack } from "../provisioning/packs/core.js";

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

/**
 * The catalog approval defaults every workspace held before ADR-0009, as
 * `[commandType, categoryCode, amountMaxMinor, roles]` (provisioning/packs/core.ts
 * at the commit before the role swap). Frozen: this is the data 0036 rewrites.
 */
const PRE_ADR_0009_DEFAULTS: ReadonlyArray<readonly [string, string | null, number | null, string]> = [
  ["register-asset", null, null, "ADMIN,OPS_MANAGER"],
  ["commission-asset", null, null, "ADMIN,OPS_MANAGER"],
  ["assign-asset", null, null, "ADMIN,OPS_MANAGER"],
  ["assign-asset", "CROSS_BRANCH", null, "FINANCE_APPROVER"],
  ["enable-module", null, null, "ADMIN"],
  ["disable-module", null, null, "ADMIN"],
  ["update-approval-threshold", null, null, "ADMIN"],
  ["add-or-renew-document", null, null, "ADMIN,OPS_MANAGER,FIELD_SUBMITTER"],
  ["create-category", null, null, "ADMIN"],
  ["relabel-category", null, null, "ADMIN"],
  ["deactivate-category", null, null, "ADMIN"],
  ["reactivate-category", null, null, "ADMIN"],
  ["set-template-preset", null, null, "ADMIN"],
  ["create-branch", null, null, "ADMIN"],
  ["rename-branch", null, null, "ADMIN"],
  ["set-branch-status", null, null, "ADMIN"],
  ["add-member", null, null, "ADMIN"],
  ["update-member-role", null, null, "ADMIN"],
  ["deactivate-member", null, null, "ADMIN"],
  ["reactivate-member", null, null, "ADMIN"],
  ["reset-member-pin", null, null, "ADMIN"],
  ["record-expense", null, 100000, "FIELD_SUBMITTER,OPS_MANAGER,FINANCE_APPROVER,ADMIN,MAINTENANCE"],
  ["record-expense", null, null, "FINANCE_APPROVER,ADMIN"],
  ["record-revenue", null, 100000, "FIELD_SUBMITTER,OPS_MANAGER,FINANCE_APPROVER,ADMIN"],
  ["record-revenue", null, null, "FINANCE_APPROVER,ADMIN"],
  ["approve-entry", null, null, "FINANCE_APPROVER,ADMIN"],
  ["reject-entry", null, null, "FINANCE_APPROVER,ADMIN"],
  ["reverse-entry", null, null, "FINANCE_APPROVER,ADMIN"],
  ["lock-period", null, null, "FINANCE_APPROVER,ADMIN"],
  ["reopen-period", null, null, "FINANCE_APPROVER,ADMIN"],
  ["register-person", null, null, "ADMIN,OPS_MANAGER"],
  ["reopen-activity", null, null, "ADMIN,OPS_MANAGER"],
  ["create-activity", null, null, "ADMIN,OPS_MANAGER,FIELD_SUBMITTER"],
  ["record-movement-leg", null, null, "ADMIN,OPS_MANAGER,FIELD_SUBMITTER"],
  ["record-meter-reading", null, null, "ADMIN,OPS_MANAGER,FIELD_SUBMITTER,MAINTENANCE"],
  ["substitute-asset", null, null, "ADMIN,OPS_MANAGER,FIELD_SUBMITTER"],
  ["close-activity", null, null, "ADMIN,OPS_MANAGER,FIELD_SUBMITTER"],
  ["record-journey-sheet", null, null, "ADMIN,OPS_MANAGER,FIELD_SUBMITTER"],
  ["record-haulage-job-sheet", null, null, "ADMIN,OPS_MANAGER,FIELD_SUBMITTER"],
  ["report-issue", null, null, "ADMIN,OPS_MANAGER,FIELD_SUBMITTER,MAINTENANCE"],
  ["resolve-issue", null, null, "ADMIN,OPS_MANAGER,FIELD_SUBMITTER,MAINTENANCE"],
  ["create-work-order", null, null, "ADMIN,OPS_MANAGER,MAINTENANCE"],
  ["complete-work-order", null, null, "ADMIN,OPS_MANAGER,MAINTENANCE"],
  ["cancel-work-order", null, null, "ADMIN,OPS_MANAGER,MAINTENANCE"],
  ["dismiss-issue", null, null, "ADMIN,OPS_MANAGER,MAINTENANCE"],
  ["release-asset-to-service", null, null, "ADMIN,OPS_MANAGER"],
  ["update-asset-details", null, null, "ADMIN,OPS_MANAGER"],
  ["attach-evidence", null, null, "FIELD_SUBMITTER,OPS_MANAGER,FINANCE_APPROVER,ADMIN,MAINTENANCE"],
  ["update-pending-entry", null, null, "FIELD_SUBMITTER,OPS_MANAGER,FINANCE_APPROVER,ADMIN,MAINTENANCE"],
  ["add-note", null, null, "ADMIN,OPS_MANAGER,FIELD_SUBMITTER,MAINTENANCE,FINANCE_APPROVER"],
  ["approve-work-order", null, null, "FINANCE_APPROVER,ADMIN"],
  ["reject-work-order", null, null, "FINANCE_APPROVER,ADMIN"],
  ["approve-work-order-closure", null, null, "FINANCE_APPROVER,ADMIN"],
  ["reject-work-order-completion", null, null, "FINANCE_APPROVER,ADMIN"],
];

const OLD_ROLES = [
  "ADMIN",
  "OPS_MANAGER",
  "EXECUTIVE_VIEWER",
  "FIELD_SUBMITTER",
  "MAINTENANCE",
  "FINANCE_APPROVER",
] as const;

type RuleRow = {
  command_type: string;
  category_code: string | null;
  amount_max_minor: string | null;
  required_role: string;
};

function ruleKey(rule: RuleRow): string {
  return [rule.command_type, rule.category_code ?? "*", rule.amount_max_minor ?? "*", rule.required_role].join(":");
}

/**
 * 0036 against a database seeded with the old roles: migrated to 0035 from a
 * truncated journal, seeded with every old role and the old catalog defaults,
 * then brought forward by the real migrator — the path a deployed box takes.
 * Its own database inside the suite's container (guard T1).
 */
describe("0036 six roles on a database seeded with the old roles", () => {
  const databaseName = `pre0036_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let truncatedFolder: string;

  const ws = randomUUID();
  const customWs = randomUUID();
  const branch = randomUUID();
  const membershipByOldRole = new Map(OLD_ROLES.map((role) => [role, randomUUID()]));
  const citedRule = randomUUID();
  const citingCommand = randomUUID();
  const actor = randomUUID();

  async function query<T>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await pool.query(text, values)).rows as T[];
  }

  async function seedDefaults(workspaceId: string): Promise<void> {
    for (const [commandType, categoryCode, amountMax, roles] of PRE_ADR_0009_DEFAULTS) {
      for (const role of roles.split(",")) {
        await pool.query(
          `INSERT INTO approval_rules (workspace_id, command_type, category_code, amount_max_minor, required_role)
           VALUES ($1, $2, $3, $4, $5)`,
          [workspaceId, commandType, categoryCode, amountMax, role],
        );
      }
    }
  }

  beforeAll(async () => {
    const ownerUrl = inject("databaseUrl");
    adminPool = new pg.Pool({ connectionString: ownerUrl });
    await adminPool.query(`CREATE DATABASE ${databaseName}`);
    const url = new URL(ownerUrl);
    url.pathname = `/${databaseName}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    pool.on("error", () => {});

    truncatedFolder = await mkdtemp(join(tmpdir(), "routiq-pre0036-"));
    await cp(MIGRATIONS, truncatedFolder, { recursive: true });
    const journalPath = join(truncatedFolder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: Array<{ idx: number }> };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 35);
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(drizzle(pool), { migrationsFolder: truncatedFolder });

    await pool.query(`
      INSERT INTO workspaces (id, slug, name) VALUES
        ('${ws}', 'pre-0036-${ws.slice(0, 8)}', 'Transports Pré-0036'),
        ('${customWs}', 'pre-0036-${customWs.slice(0, 8)}', 'Bandes maison');
      INSERT INTO branches (id, workspace_id, code, name) VALUES ('${branch}', '${customWs}', 'DLA', 'Douala');
    `);
    for (const [role, membershipId] of membershipByOldRole) {
      const principal = randomUUID();
      await pool.query(`INSERT INTO principals (id, principal_type, display_name) VALUES ($1, 'HUMAN', $2)`, [principal, role]);
      await pool.query(
        `INSERT INTO memberships (id, workspace_id, principal_id, role, all_branches) VALUES ($1, $2, $3, $4, true)`,
        [membershipId, ws, principal, role],
      );
    }
    await seedDefaults(ws);
    await seedDefaults(customWs);

    // A tenant's own rules: a fuel band for drivers, a branch rule for ops.
    await pool.query(`
      INSERT INTO approval_rules (workspace_id, command_type, category_code, amount_max_minor, required_role)
        VALUES ('${customWs}', 'record-expense', 'FUEL', 50000, 'FIELD_SUBMITTER');
      INSERT INTO approval_rules (workspace_id, command_type, branch_id, required_role)
        VALUES ('${customWs}', 'create-work-order', '${branch}', 'OPS_MANAGER');
      -- An old ADMIN approval a receipt cites: ADMIN no longer approves entries,
      -- but the receipt's FK keeps the row.
      INSERT INTO approval_rules (id, workspace_id, command_type, category_code, required_role)
        VALUES ('${citedRule}', '${customWs}', 'approve-entry', 'FUEL', 'ADMIN');
      INSERT INTO principals (id, principal_type, display_name) VALUES ('${actor}', 'HUMAN', 'Admin');
      INSERT INTO memberships (workspace_id, principal_id, role, all_branches) VALUES ('${customWs}', '${actor}', 'ADMIN', true);
      INSERT INTO commands (id, workspace_id, command_type, origin, status, initiated_by_principal_id, idempotency_key, payload, approval_outcome, approval_rule_id)
        VALUES ('${citingCommand}', '${customWs}', 'approve-entry', 'HUMAN_UI', 'EXECUTED', '${actor}', 'cited-1', '{}', 'AUTO_APPROVED', '${citedRule}');
    `);

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
  });

  afterAll(async () => {
    await pool?.end();
    await adminPool?.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await adminPool?.end();
    if (truncatedFolder) await rm(truncatedFolder, { recursive: true, force: true });
  });

  it("maps every old membership role and promotes nobody to DIRECTOR", async () => {
    const rows = await query<{ id: string; role: string; row_version: number }>(
      `SELECT id, role, row_version FROM memberships WHERE workspace_id = $1`,
      [ws],
    );
    const roleOf = (old: (typeof OLD_ROLES)[number]) => rows.find((row) => row.id === membershipByOldRole.get(old))?.role;
    expect({
      ADMIN: roleOf("ADMIN"),
      OPS_MANAGER: roleOf("OPS_MANAGER"),
      EXECUTIVE_VIEWER: roleOf("EXECUTIVE_VIEWER"),
      FIELD_SUBMITTER: roleOf("FIELD_SUBMITTER"),
      MAINTENANCE: roleOf("MAINTENANCE"),
      FINANCE_APPROVER: roleOf("FINANCE_APPROVER"),
    }).toEqual({
      ADMIN: "ADMIN",
      OPS_MANAGER: "ADMIN",
      EXECUTIVE_VIEWER: "ADMIN",
      FIELD_SUBMITTER: "DRIVER",
      MAINTENANCE: "TECHNICIAN",
      FINANCE_APPROVER: "FINANCE",
    });
    expect(rows.map((row) => row.role)).not.toContain("DIRECTOR");
  });

  it("leaves no old role code in any role column", async () => {
    const stale = await query<{ n: string }>(
      `SELECT (SELECT count(*) FROM memberships WHERE role NOT IN ('DIRECTOR','ADMIN','FINANCE','CASHIER','TECHNICIAN','DRIVER'))
            + (SELECT count(*) FROM approval_rules WHERE required_role NOT IN ('DIRECTOR','ADMIN','FINANCE','CASHIER','TECHNICIAN','DRIVER')) AS n`,
    );
    expect(stale[0]?.n).toBe("0");
  });

  it("turns the old catalog defaults into exactly what a new workspace is provisioned with", async () => {
    const migrated = (
      await query<RuleRow>(
        `SELECT command_type, category_code, amount_max_minor::text, required_role FROM approval_rules WHERE workspace_id = $1`,
        [ws],
      )
    )
      .map(ruleKey)
      .sort();
    const provisioned = corePack.approvalRules
      .map((rule) =>
        ruleKey({
          command_type: rule.commandType,
          category_code: rule.categoryCode ?? null,
          amount_max_minor: rule.amountMaxMinor == null ? null : rule.amountMaxMinor.toString(),
          required_role: rule.requiredRole,
        }),
      )
      .sort();
    expect(migrated).toEqual(provisioned);
  });

  it("carries a tenant's own rules across, with DIRECTOR and CASHIER beside the driver band", async () => {
    const rules = await query<RuleRow & { branch_id: string | null }>(
      `SELECT command_type, category_code, amount_max_minor::text, required_role, branch_id
       FROM approval_rules WHERE workspace_id = $1 AND (category_code = 'FUEL' OR branch_id IS NOT NULL)`,
      [customWs],
    );
    const keys = rules.map((rule) => `${ruleKey(rule)}:${rule.branch_id === null ? "*" : "branch"}`).sort();
    expect(keys).toEqual(
      [
        "approve-entry:FUEL:*:ADMIN:*",
        "approve-entry:FUEL:*:DIRECTOR:*",
        "create-work-order:*:*:ADMIN:branch",
        "create-work-order:*:*:DIRECTOR:branch",
        "record-expense:FUEL:50000:CASHIER:*",
        "record-expense:FUEL:50000:DIRECTOR:*",
        "record-expense:FUEL:50000:DRIVER:*",
      ].sort(),
    );
  });

  it("keeps a rule a command receipt cites even when its role lost the command", async () => {
    const [row] = await query<{ required_role: string }>(`SELECT required_role FROM approval_rules WHERE id = $1`, [citedRule]);
    expect(row?.required_role).toBe("ADMIN");
  });
});
