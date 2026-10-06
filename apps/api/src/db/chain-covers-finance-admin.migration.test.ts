import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

/**
 * 0038 on workspaces as 0037 left them (#412): FINANCE and ADMIN lose the
 * unbounded recording rule, so their own entries above the band wait; DIRECTOR
 * keeps its. ADMIN also loses the unbounded rule kept beside a work-order band.
 * Its own database inside the suite's container (guard T1).
 */
describe("0038 the chain covers Finance and the Administrateur", () => {
  const databaseName = `pre0038_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let truncatedFolder: string;

  const defaultWs = randomUUID();
  const provisionedWs = randomUUID();
  const movedWs = randomUUID();
  const citedWs = randomUUID();
  const noBandWs = randomUUID();
  const workOrderWs = randomUUID();
  const provisioning = randomUUID();
  const citedRule = randomUUID();
  let operator: string;

  async function query<T>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await pool.query(text, values)).rows as T[];
  }

  async function rule(
    workspaceId: string,
    commandType: string,
    role: string,
    amountMax: number | null = null,
    options: { id?: string; createdBy?: string } = {},
  ): Promise<void> {
    await pool.query(
      `INSERT INTO approval_rules (id, workspace_id, command_type, amount_max_minor, required_role, created_by_command_id)
       VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6)`,
      [
        options.id ?? null,
        workspaceId,
        commandType,
        amountMax,
        role,
        options.createdBy ?? (workspaceId === provisionedWs ? provisioning : null),
      ],
    );
  }

  /** Catalog recording defaults (provisioning/packs/core.ts before #412), at a given band. */
  async function recordingDefaults(workspaceId: string, band: number): Promise<void> {
    for (const role of ["DRIVER", "ADMIN", "FINANCE", "DIRECTOR", "TECHNICIAN", "CASHIER"]) {
      await rule(workspaceId, "record-expense", role, band);
    }
    for (const role of ["ADMIN", "FINANCE", "DIRECTOR", "CASHIER"]) {
      await rule(workspaceId, "record-revenue", role, band);
    }
    for (const commandType of ["record-expense", "record-revenue"]) {
      for (const role of ["FINANCE", "ADMIN", "DIRECTOR"]) {
        if (workspaceId === citedWs && commandType === "record-expense" && role === "FINANCE") {
          await rule(workspaceId, commandType, role, null, { id: citedRule });
        } else {
          await rule(workspaceId, commandType, role);
        }
      }
    }
  }

  async function rules(workspaceId: string, commandType: string): Promise<string[]> {
    const rows = await query<{ required_role: string; amount_max_minor: string | null }>(
      `SELECT required_role, amount_max_minor::text FROM approval_rules
       WHERE workspace_id = $1 AND command_type = $2`,
      [workspaceId, commandType],
    );
    return rows.map((row) => `${row.required_role}:${row.amount_max_minor ?? "*"}`).sort();
  }

  async function command(workspaceId: string, commandType: string, ruleId: string | null = null): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO commands (id, workspace_id, command_type, origin, status, initiated_by_principal_id, idempotency_key, payload, approval_outcome, approval_rule_id)
       VALUES ($1, $2, $3, 'HUMAN_UI', 'EXECUTED', $4, $5, '{}', 'AUTO_APPROVED', $6)`,
      [id, workspaceId, commandType, operator, `idem-${id}`, ruleId],
    );
    return id;
  }

  beforeAll(async () => {
    const ownerUrl = inject("databaseUrl");
    adminPool = new pg.Pool({ connectionString: ownerUrl });
    await adminPool.query(`CREATE DATABASE ${databaseName}`);
    const url = new URL(ownerUrl);
    url.pathname = `/${databaseName}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    pool.on("error", () => {});

    truncatedFolder = await mkdtemp(join(tmpdir(), "routiq-pre0038-"));
    await cp(MIGRATIONS, truncatedFolder, { recursive: true });
    const journalPath = join(truncatedFolder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: Array<{ idx: number }> };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 37);
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(drizzle(pool), { migrationsFolder: truncatedFolder });

    for (const [id, slug] of [
      [defaultWs, "defaults"],
      [provisionedWs, "provisioned"],
      [movedWs, "moved"],
      [citedWs, "cited"],
      [noBandWs, "noband"],
      [workOrderWs, "workorder"],
    ] as const) {
      await pool.query(`INSERT INTO workspaces (id, slug, name) VALUES ($1, $2, $2)`, [id, `pre0038-${slug}-${id.slice(0, 8)}`]);
    }
    operator = randomUUID();
    await pool.query(`INSERT INTO principals (id, principal_type, display_name) VALUES ($1, 'HUMAN', 'Operator')`, [operator]);
    await pool.query(
      `INSERT INTO commands (id, workspace_id, scope, command_type, origin, status, initiated_by_principal_id, idempotency_key, payload, approval_outcome)
       VALUES ($1, $2, 'PLATFORM', 'provision-workspace', 'API', 'EXECUTED', $3, 'provision-1', '{}', 'AUTO_APPROVED')`,
      [provisioning, provisionedWs, operator],
    );

    for (const ws of [citedWs, workOrderWs]) {
      await pool.query(
        `INSERT INTO memberships (workspace_id, principal_id, role, all_branches) VALUES ($1, $2, 'DIRECTOR', true)`,
        [ws, operator],
      );
    }

    await recordingDefaults(defaultWs, 100_000);
    await recordingDefaults(provisionedWs, 100_000);
    await recordingDefaults(movedWs, 250_000);
    await recordingDefaults(citedWs, 100_000);
    // A Finance entry the unbounded rule posted: the receipt keeps citing it.
    await command(citedWs, "record-expense", citedRule);

    // Only the driver holds a band; the unbounded rules take the workspace's.
    await rule(noBandWs, "record-expense", "DRIVER", 80_000);
    await rule(noBandWs, "record-expense", "FINANCE");
    await rule(noBandWs, "record-expense", "DIRECTOR");

    // Direction set a work-order band: ADMIN kept its unbounded rule beside it.
    // complete-work-order was never banded, so nothing there changes.
    const threshold = await command(workOrderWs, "update-approval-threshold");
    for (const role of ["DIRECTOR", "ADMIN", "TECHNICIAN"]) {
      await rule(workOrderWs, "complete-work-order", role);
    }
    await rule(workOrderWs, "create-work-order", "DIRECTOR");
    await rule(workOrderWs, "create-work-order", "ADMIN");
    await rule(workOrderWs, "create-work-order", "TECHNICIAN", 200_000);
    await rule(workOrderWs, "create-work-order", "DIRECTOR", 200_000, { createdBy: threshold });
    await rule(workOrderWs, "create-work-order", "ADMIN", 200_000, { createdBy: threshold });

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
  });

  afterAll(async () => {
    await pool?.end();
    await adminPool?.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await adminPool?.end();
    if (truncatedFolder) await rm(truncatedFolder, { recursive: true, force: true });
  });

  const expenseAt = (band: string) =>
    ["DRIVER", "ADMIN", "FINANCE", "DIRECTOR", "TECHNICIAN", "CASHIER"].map((role) => `${role}:${band}`).concat("DIRECTOR:*").sort();
  const revenueAt = (band: string) =>
    ["ADMIN", "FINANCE", "DIRECTOR", "CASHIER"].map((role) => `${role}:${band}`).concat("DIRECTOR:*").sort();

  it("leaves Direction the only unbounded recording rule", async () => {
    for (const ws of [defaultWs, provisionedWs]) {
      expect(await rules(ws, "record-expense")).toEqual(expenseAt("100000"));
      expect(await rules(ws, "record-revenue")).toEqual(revenueAt("100000"));
    }
  });

  it("keeps the band the tenant moved", async () => {
    expect(await rules(movedWs, "record-expense")).toEqual(expenseAt("250000"));
    expect(await rules(movedWs, "record-revenue")).toEqual(revenueAt("250000"));
  });

  it("bounds a rule a receipt cites in place instead of deleting it", async () => {
    const [row] = await query<{ amount_max_minor: string | null; row_version: number }>(
      `SELECT amount_max_minor::text, row_version FROM approval_rules WHERE id = $1`,
      [citedRule],
    );
    expect(row).toEqual({ amount_max_minor: "100000", row_version: 2 });
    expect(await rules(citedWs, "record-expense")).toEqual([...expenseAt("100000"), "FINANCE:100000"].sort());
  });

  it("gives a role without a band of its own the workspace's band", async () => {
    expect(await rules(noBandWs, "record-expense")).toEqual(["DIRECTOR:*", "DRIVER:80000", "FINANCE:80000"]);
  });

  it("drops the Administrateur's unbounded rule beside a work-order band, and only there", async () => {
    expect(await rules(workOrderWs, "create-work-order")).toEqual(
      ["ADMIN:200000", "DIRECTOR:*", "DIRECTOR:200000", "TECHNICIAN:200000"].sort(),
    );
    expect(await rules(workOrderWs, "complete-work-order")).toEqual(["ADMIN:*", "DIRECTOR:*", "TECHNICIAN:*"]);
  });
});
