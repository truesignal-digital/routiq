import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

interface BranchRow {
  id: string;
  code: string;
  name: string;
  timezone: string;
  active: boolean;
  rowVersion: number;
}

describe("GET /v1/branches", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  let seededBranchId: string;
  let adminToken: string;
  let scopedAdminToken: string;
  let opsToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await seedWorkspace(ctx.db, `ws-branch-${randomUUID().slice(0, 8)}`);
    workspaceId = seeded.workspace.id;
    seededBranchId = seeded.branch.id;

    const admin = await seedMember(ctx.db, {
      workspaceId,
      role: "DIRECTOR",
      allBranches: true,
    });
    adminToken = (
      await createSession(ctx.db, { workspaceId, principalId: admin.principal.id })
    ).token;

    // An admin whose membership names one branch: administration is
    // workspace-level, so this read must still show every branch.
    const scopedAdmin = await seedMember(ctx.db, {
      workspaceId,
      role: "ADMIN",
      branchIds: [seededBranchId],
    });
    scopedAdminToken = (
      await createSession(ctx.db, { workspaceId, principalId: scopedAdmin.principal.id })
    ).token;

    const ops = await seedMember(ctx.db, {
      workspaceId,
      role: "CASHIER",
      allBranches: true,
    });
    opsToken = (
      await createSession(ctx.db, { workspaceId, principalId: ops.principal.id })
    ).token;
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function list(query = "", token = adminToken) {
    return ctx.app.inject({
      method: "GET",
      url: `/v1/branches${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async function command(name: string, payload: Record<string, unknown>) {
    return ctx.app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload,
      },
    });
  }

  it("returns branches with the fields the screen renders", async () => {
    const branchId = randomUUID();
    expect(
      (
        await command("create-branch", {
          branchId,
          code: "YDE",
          name: "Yaoundé",
        })
      ).statusCode,
    ).toBe(200);

    const response = await list();
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: BranchRow[]; nextCursor: string | null };

    expect(body.items.find((item) => item.id === branchId)).toEqual({
      id: branchId,
      code: "YDE",
      name: "Yaoundé",
      timezone: "Africa/Douala",
      active: true,
      rowVersion: 1,
    });
  });

  it("keeps a deactivated branch in the list — reactivating it happens here", async () => {
    const branchId = randomUUID();
    expect(
      (
        await command("create-branch", { branchId, code: "GRA", name: "Garoua" })
      ).statusCode,
    ).toBe(200);

    expect(
      (await command("set-branch-status", { branchId, active: false })).statusCode,
    ).toBe(200);

    const body = (await list()).json() as { items: BranchRow[] };
    const row = body.items.find((item) => item.id === branchId);
    expect(row).toMatchObject({ code: "GRA", active: false, rowVersion: 2 });
  });

  it("shows every branch to an admin whose membership names only one", async () => {
    const mine = (await list("?limit=100")).json() as { items: BranchRow[] };
    const scoped = (await list("?limit=100", scopedAdminToken)).json() as {
      items: BranchRow[];
    };

    expect(scoped.items.map((item) => item.id).sort()).toEqual(
      mine.items.map((item) => item.id).sort(),
    );
    expect(scoped.items.length).toBeGreaterThan(1);
  });

  it("pages by code and refuses a cursor minted under another sort", async () => {
    const page = await list("?limit=1");
    expect(page.statusCode).toBe(200);
    const body = page.json() as { items: BranchRow[]; nextCursor: string | null };
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).not.toBeNull();

    const next = await list(`?limit=1&cursor=${encodeURIComponent(body.nextCursor!)}`);
    expect(next.statusCode).toBe(200);
    const nextBody = next.json() as { items: BranchRow[] };
    expect(nextBody.items[0]!.id).not.toBe(body.items[0]!.id);
    expect(nextBody.items[0]!.code > body.items[0]!.code).toBe(true);

    const resorted = await list(
      `?limit=1&sort=code:desc&cursor=${encodeURIComponent(body.nextCursor!)}`,
    );
    expect(resorted.statusCode).toBe(400);
    expect(resorted.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("is for DIRECTOR and ADMIN only", async () => {
    const response = await list("", opsToken);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });
  });

  it("requires authentication", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/v1/branches" });
    expect(response.statusCode).toBe(401);
  });

  it("never lists another workspace's branches", async () => {
    const other = await seedWorkspace(
      ctx.db,
      `ws-branch-other-${randomUUID().slice(0, 8)}`,
    );
    const otherAdmin = await seedMember(ctx.db, {
      workspaceId: other.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    const otherToken = (
      await createSession(ctx.db, {
        workspaceId: other.workspace.id,
        principalId: otherAdmin.principal.id,
      })
    ).token;

    const theirs = (await list("?limit=100", otherToken)).json() as {
      items: BranchRow[];
    };
    expect(theirs.items).toHaveLength(1);
    expect(theirs.items[0]!.id).toBe(other.branch.id);

    const mine = (await list("?limit=100")).json() as { items: BranchRow[] };
    expect(mine.items.some((item) => item.id === other.branch.id)).toBe(false);
  });
});
