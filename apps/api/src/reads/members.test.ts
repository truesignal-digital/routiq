import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { credentials } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

interface MemberRow {
  principalId: string;
  displayName: string;
  username: string | null;
  role: string;
  branchScope: "ALL" | string[];
  status: string;
  rowVersion: number;
  createdAt: string;
}

describe("GET /v1/members", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  let branchId: string;
  let adminToken: string;
  let opsToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await seedWorkspace(ctx.db, `ws-read-${randomUUID().slice(0, 8)}`);
    workspaceId = seeded.workspace.id;
    branchId = seeded.branch.id;

    const admin = await seedMember(ctx.db, {
      workspaceId,
      role: "DIRECTOR",
      allBranches: true,
    });
    adminToken = (
      await createSession(ctx.db, { workspaceId, principalId: admin.principal.id })
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
      url: `/v1/members${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async function addMember(payload: Record<string, unknown>) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands/add-member",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        version: 2,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload,
      },
    });
  }

  it("returns members with the fields the Users screen renders", async () => {
    const principalId = randomUUID();
    const username = `read-${randomUUID().slice(0, 8)}`;
    expect(
      (
        await addMember({
          principalId,
          displayName: "Aïcha Moussa",
          username,
          pin: "4821",
          role: "TECHNICIAN",
          branchScope: [branchId],
        })
      ).statusCode,
    ).toBe(200);

    const response = await list();
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: MemberRow[]; nextCursor: string | null };

    const row = body.items.find((item) => item.principalId === principalId);
    expect(row).toMatchObject({
      displayName: "Aïcha Moussa",
      username,
      role: "TECHNICIAN",
      branchScope: [branchId],
      status: "ACTIVE",
      rowVersion: 1,
    });
    expect(typeof row?.createdAt).toBe("string");
  });

  it("shows a member who holds no credential with a null username", async () => {
    const bare = await seedMember(ctx.db, {
      workspaceId,
      role: "FINANCE",
      allBranches: true,
    });

    const body = (await list()).json() as { items: MemberRow[] };
    const row = body.items.find((item) => item.principalId === bare.principal.id);
    expect(row).toMatchObject({ username: null, status: "ACTIVE" });
  });

  it("derives LOCKED from a live lockout and lets it lapse on its own", async () => {
    const principalId = randomUUID();
    expect(
      (
        await addMember({
          principalId,
          displayName: "Verrouillé",
          username: `locked-${randomUUID().slice(0, 8)}`,
          pin: "4821",
          role: "DRIVER",
          branchScope: "ALL",
        })
      ).statusCode,
    ).toBe(200);

    const setLock = (lockedUntil: Date | null) =>
      ctx.db
        .update(credentials)
        .set({ lockedUntil })
        .where(
          and(
            eq(credentials.workspaceId, workspaceId),
            eq(credentials.principalId, principalId),
          ),
        );

    await setLock(new Date(Date.now() + 15 * 60 * 1000));
    const locked = (await list()).json() as { items: MemberRow[] };
    expect(
      locked.items.find((item) => item.principalId === principalId)?.status,
    ).toBe("LOCKED");

    // An expired lockout is simply not a lockout — nothing sweeps it.
    await setLock(new Date(Date.now() - 1000));
    const lapsed = (await list()).json() as { items: MemberRow[] };
    expect(
      lapsed.items.find((item) => item.principalId === principalId)?.status,
    ).toBe("ACTIVE");
  });

  it("hides deactivated members until they are asked for", async () => {
    const principalId = randomUUID();
    expect(
      (
        await addMember({
          principalId,
          displayName: "Parti",
          username: `gone-${randomUUID().slice(0, 8)}`,
          pin: "4821",
          role: "DRIVER",
          branchScope: "ALL",
        })
      ).statusCode,
    ).toBe(200);

    await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/deactivate-member",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: { principalId },
      },
    });

    const hidden = (await list()).json() as { items: MemberRow[] };
    expect(hidden.items.some((item) => item.principalId === principalId)).toBe(false);

    const shown = (await list("?includeDeactivated=true")).json() as {
      items: MemberRow[];
    };
    expect(
      shown.items.find((item) => item.principalId === principalId)?.status,
    ).toBe("DEACTIVATED");
  });

  it("pages by display name and refuses a cursor minted under another sort", async () => {
    const page = await list("?limit=1");
    expect(page.statusCode).toBe(200);
    const body = page.json() as { items: MemberRow[]; nextCursor: string | null };
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).not.toBeNull();

    const next = await list(`?limit=1&cursor=${encodeURIComponent(body.nextCursor!)}`);
    expect(next.statusCode).toBe(200);
    const nextBody = next.json() as { items: MemberRow[] };
    expect(nextBody.items[0]!.principalId).not.toBe(body.items[0]!.principalId);
    expect(
      nextBody.items[0]!.displayName >= body.items[0]!.displayName,
    ).toBe(true);

    const resorted = await list(
      `?limit=1&sort=displayName:desc&cursor=${encodeURIComponent(body.nextCursor!)}`,
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
    const response = await ctx.app.inject({ method: "GET", url: "/v1/members" });
    expect(response.statusCode).toBe(401);
  });

  it("never lists another workspace's members", async () => {
    const other = await seedWorkspace(ctx.db, `ws-read-other-${randomUUID().slice(0, 8)}`);
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

    const mine = (await list("?includeDeactivated=true&limit=100")).json() as {
      items: MemberRow[];
    };
    const theirs = (
      await list("?includeDeactivated=true&limit=100", otherToken)
    ).json() as { items: MemberRow[] };

    expect(theirs.items).toHaveLength(1);
    expect(theirs.items[0]!.principalId).toBe(otherAdmin.principal.id);

    const mineIds = new Set(mine.items.map((item) => item.principalId));
    expect(mineIds.has(otherAdmin.principal.id)).toBe(false);
    for (const item of theirs.items) {
      expect(mineIds.has(item.principalId)).toBe(false);
    }
  });
});
