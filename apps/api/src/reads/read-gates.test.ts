import { randomUUID } from "node:crypto";
import { dashboardResponse, type Role } from "@routiq/contracts";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { branches } from "../db/schema.js";
import { inWorkspaceRead } from "../db/tenant.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import { ANY_ROLE, UNGATED_READS, defineRead, requireReadGates } from "./define-read.js";

const FINANCE_READS = [
  "/v1/finance/entries",
  `/v1/finance/entries/${randomUUID()}`,
  "/v1/finance/approvals",
  "/v1/finance/periods",
];

describe("read gates (#59)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  const tokens = new Map<string, string>();

  const read = (token: string, url: string) =>
    ctx.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });

  const command = (token: string, name: string, payload: object) =>
    ctx.app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        envelope: { commandId: randomUUID(), idempotencyKey: randomUUID(), origin: "HUMAN_UI" },
        payload,
      },
    });

  async function member(wsId: string, branchId: string, role: Role, key: string) {
    const seeded = await seedMember(ctx.db, {
      workspaceId: wsId,
      role,
      allBranches: role === "ADMIN" || role === "DIRECTOR",
      branchIds: role === "ADMIN" || role === "DIRECTOR" ? [] : [branchId],
    });
    const session = await createSession(ctx.db, { principalId: seeded.principal.id, workspaceId: wsId });
    tokens.set(key, session.token);
  }

  const token = (key: string) => {
    const value = tokens.get(key);
    if (value === undefined) throw new Error(`no token ${key}`);
    return value;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    const open = await seedWorkspace(ctx.db);
    workspaceId = open.workspace.id;
    await member(open.workspace.id, open.branch.id, "ADMIN", "admin");
    await member(open.workspace.id, open.branch.id, "TECHNICIAN", "technician");
    await member(open.workspace.id, open.branch.id, "FINANCE", "finance");

    const closed = await seedWorkspace(ctx.db);
    await member(closed.workspace.id, closed.branch.id, "DIRECTOR", "closedAdmin");
    for (const moduleCode of ["FINANCE", "DOCUMENTS", "ASSETS", "ACTIVITIES"]) {
      const response = await command(token("closedAdmin"), "disable-module", { moduleCode });
      expect(response.statusCode, response.body).toBe(200);
    }
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it("refuses finance reads to a role outside LEDGER_READER_ROLES", async () => {
    for (const url of FINANCE_READS) {
      const response = await read(token("technician"), url);
      expect(response.statusCode, url).toBe(403);
      expect(response.json(), url).toEqual({ error: { code: "ROLE_FORBIDDEN" } });
    }
  });

  it("serves finance reads to a role inside LEDGER_READER_ROLES", async () => {
    for (const url of ["/v1/finance/entries", "/v1/finance/approvals", "/v1/finance/periods"]) {
      expect((await read(token("finance"), url)).statusCode, url).toBe(200);
    }
  });

  it("refuses finance reads when FINANCE is disabled, even to an admin", async () => {
    for (const url of FINANCE_READS) {
      const response = await read(token("closedAdmin"), url);
      expect(response.statusCode, url).toBe(403);
      expect(response.json(), url).toEqual({
        error: { code: "MODULE_DISABLED", metadata: { module: "FINANCE" } },
      });
    }
  });

  it("refuses an asset's documents when DOCUMENTS is disabled", async () => {
    const response = await read(token("closedAdmin"), `/v1/assets/${randomUUID()}/documents`);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: { code: "MODULE_DISABLED", metadata: { module: "DOCUMENTS" } },
    });
  });

  it("refuses asset and activity reads when their module is disabled", async () => {
    for (const [url, module] of [
      ["/v1/assets", "ASSETS"],
      ["/v1/assets/summary", "ASSETS"],
      [`/v1/assets/${randomUUID()}`, "ASSETS"],
      ["/v1/activities", "ACTIVITIES"],
      ["/v1/persons", "ACTIVITIES"],
      ["/v1/places", "ACTIVITIES"],
    ] as const) {
      const response = await read(token("closedAdmin"), url);
      expect(response.statusCode, url).toBe(403);
      expect(response.json(), url).toEqual({ error: { code: "MODULE_DISABLED", metadata: { module } } });
    }
  });

  it("keeps member and branch administration to admins", async () => {
    for (const url of ["/v1/members", "/v1/branches"]) {
      expect((await read(token("technician"), url)).json(), url).toEqual({ error: { code: "ROLE_FORBIDDEN" } });
      expect((await read(token("admin"), url)).statusCode, url).toBe(200);
    }
  });

  it("serves identity and reference reads to every role, whatever modules are off", async () => {
    for (const url of ["/v1/me", "/v1/commands", "/v1/categories?kind=EXPENSE_CATEGORY", "/v1/reference/asset-registration"]) {
      expect((await read(token("technician"), url)).statusCode, url).toBe(200);
      expect((await read(token("closedAdmin"), url)).statusCode, url).toBe(200);
    }
  });

  it("gives a non-finance role the home screen without finance figures", async () => {
    const response = await read(token("technician"), "/v1/dashboard");
    expect(response.statusCode).toBe(200);
    const body = dashboardResponse.parse(response.json());
    expect(body.assets.total).toBeGreaterThanOrEqual(0);
    expect(body.openPeriod).toBeNull();
    expect(body.pendingApprovals).toBeNull();
    expect(body.series).toBeNull();
  });

  it("gives the home screen without finance figures when FINANCE is disabled", async () => {
    const body = dashboardResponse.parse((await read(token("closedAdmin"), "/v1/dashboard")).json());
    expect(body.pendingApprovals).toBeNull();
    expect(body.series).toBeNull();
  });

  it("keeps finance figures for a finance reader", async () => {
    const body = dashboardResponse.parse((await read(token("admin"), "/v1/dashboard")).json());
    expect(body.pendingApprovals).not.toBeNull();
    expect(body.series?.length).toBeGreaterThan(0);
  });

  it("runs reads in a transaction Postgres will not write in", async () => {
    const attempt = inWorkspaceRead(ctx.runtimeDb, workspaceId, (tx) =>
      tx.insert(branches).values({
        workspaceId,
        code: "RO",
        name: "Read only",
        createdByCommandId: randomUUID(),
      }),
    );
    await expect(attempt).rejects.toSatisfy((error: unknown) =>
      /read-only transaction/.test(String((error as { cause?: unknown }).cause ?? error)),
    );
  });
});

describe("requireReadGates", () => {
  it("has no ungated reads left: every /v1 GET on the server declares its gate", () => {
    // The server under test booted with requireReadGates, so any ungated route
    // would already have failed createTestApp; this pins the allowlist empty.
    expect([...UNGATED_READS]).toEqual([]);
  });

  it("fails the boot when a /v1 GET skips defineRead", () => {
    const app = Fastify();
    requireReadGates(app);
    expect(() => app.get("/v1/new-report", async () => ({}))).toThrow(/has no read gate/);
  });

  it("accepts a route registered through defineRead, and routes outside /v1", () => {
    const app = Fastify();
    requireReadGates(app);
    // Never called: registration alone is what the guard inspects.
    const deps = {} as Parameters<typeof defineRead>[1];
    expect(() =>
      defineRead(app, deps, { path: "/v1/new-report", module: "CORE", roles: ANY_ROLE, branchScope: "workspace" }, async () => ({})),
    ).not.toThrow();
    expect(() => app.get("/health", async () => ({ status: "ok" }))).not.toThrow();
  });
});
