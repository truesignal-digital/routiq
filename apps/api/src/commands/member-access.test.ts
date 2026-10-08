import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { branches, memberships } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedWorkspace } from "../test/seed.js";

/**
 * ADR-0009's app-access rule on the five member commands: DIRECTOR manages
 * every role but DIRECTOR in every branch; ADMIN only DRIVER, TECHNICIAN and CASHIER
 * members inside its own branches, judged on the member as they are and as the
 * command would leave them; nobody changes their own role.
 */
describe("member commands: who may manage whom", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let douala: string;
  let yaounde: string;
  let director: Actor;
  let adminDouala: Actor;
  let finance: Actor;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    douala = seeded.branch.id;
    const [second] = await ctx.db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();
    yaounde = second!.id;
    director = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    adminDouala = await seedActor(ctx.db, { workspaceId, role: "ADMIN", branchIds: [douala] });
    finance = await seedActor(ctx.db, { workspaceId, role: "FINANCE" });
  });

  afterAll(async () => {
    await ctx.close();
  });

  function addMember(actor: Actor, role: string, branchScope: unknown, version = 2) {
    const principalId = randomUUID();
    return api
      .send(
        actor.token,
        "add-member",
        {
          principalId,
          displayName: `${role} ${principalId.slice(0, 4)}`,
          username: `m-${principalId.slice(0, 8)}`,
          pin: "4821",
          role,
          branchScope,
        },
        {},
        version,
      )
      .then((reply) => ({ reply, principalId }));
  }

  async function membership(principalId: string) {
    const [row] = await ctx.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.principalId, principalId)));
    return row!;
  }

  async function updateRole(actor: Actor, principalId: string, payload: Record<string, unknown>) {
    const current = await membership(principalId);
    return api.send(
      actor.token,
      "update-member-role",
      { principalId, ...payload },
      { expectedVersion: current.rowVersion },
      2,
    );
  }

  describe("DIRECTOR", () => {
    it("adds a member of every role but DIRECTOR", async () => {
      for (const role of ["ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"]) {
        const { reply } = await addMember(director, role, [yaounde]);
        expect(reply.status, role).toBe(200);
      }
    });

    it("changes an ADMIN to FINANCE and resets an ADMIN's PIN", async () => {
      const { principalId } = await addMember(director, "ADMIN", [yaounde]);
      expect((await updateRole(director, principalId, { role: "FINANCE" })).status).toBe(200);
      expect((await membership(principalId)).role).toBe("FINANCE");
      const reset = await api.send(director.token, "reset-member-pin", { principalId, pin: "9999" });
      expect(reset.status).toBe(200);
    });

    it("cannot change their own role", async () => {
      const reply = await updateRole(director, director.principalId, { role: "ADMIN" });
      expect(reply.status).toBe(422);
      expect(reply.body.error?.code).toBe("SELF_ROLE_CHANGE");
      expect((await membership(director.principalId)).role).toBe("DIRECTOR");
    });
  });

  /**
   * ADR-0009: Direction is appointed by the vendor (`appoint-director`) or at
   * provisioning. No tenant command grants it, changes it or removes it, so a
   * DIRECTOR target is refused on every member command, for every actor.
   */
  describe("a DIRECTOR target", () => {
    it("is never granted, not even by a DIRECTOR", async () => {
      const { reply } = await addMember(director, "DIRECTOR", "ALL");
      expect(reply.status).toBe(403);
      expect(reply.body.error?.code).toBe("MEMBER_ROLE_NOT_GRANTABLE");

      const { principalId } = await addMember(director, "ADMIN", [yaounde]);
      const promote = await updateRole(director, principalId, { role: "DIRECTOR", branchScope: "ALL" });
      expect(promote.status).toBe(403);
      expect(promote.body.error?.code).toBe("MEMBER_ROLE_NOT_GRANTABLE");
      expect((await membership(principalId)).role).toBe("ADMIN");
    });

    it("is never changed nor removed by another DIRECTOR", async () => {
      const own = await seedWorkspace(ctx.db);
      const first = await seedActor(ctx.db, { workspaceId: own.workspace.id, role: "DIRECTOR" });
      const second = await seedActor(ctx.db, { workspaceId: own.workspace.id, role: "DIRECTOR" });
      const [row] = await ctx.db
        .select()
        .from(memberships)
        .where(eq(memberships.principalId, first.principalId));
      const replies = [
        await api.send(
          second.token,
          "update-member-role",
          { principalId: first.principalId, role: "ADMIN" },
          { expectedVersion: row!.rowVersion },
          2,
        ),
        await api.send(second.token, "deactivate-member", { principalId: first.principalId }),
        await api.send(second.token, "reset-member-pin", { principalId: first.principalId, pin: "1234" }),
      ];
      for (const reply of replies) {
        expect(reply.status).toBe(403);
        expect(reply.body.error?.code).toBe("MEMBER_ROLE_NOT_GRANTABLE");
      }
      const [after] = await ctx.db
        .select()
        .from(memberships)
        .where(eq(memberships.principalId, first.principalId));
      expect(after).toMatchObject({ role: "DIRECTOR", deactivatedAt: null, rowVersion: row!.rowVersion });
    });

    it("is never reactivated by a tenant command", async () => {
      const own = await seedWorkspace(ctx.db);
      const acting = await seedActor(ctx.db, { workspaceId: own.workspace.id, role: "DIRECTOR" });
      const former = await seedActor(ctx.db, { workspaceId: own.workspace.id, role: "DIRECTOR" });
      await ctx.db
        .update(memberships)
        .set({ deactivatedAt: new Date() })
        .where(eq(memberships.principalId, former.principalId));
      const reply = await api.send(acting.token, "reactivate-member", { principalId: former.principalId });
      expect(reply.status).toBe(403);
      expect(reply.body.error?.code).toBe("MEMBER_ROLE_NOT_GRANTABLE");
    });
  });

  describe("ADMIN", () => {
    it("adds a DRIVER, a TECHNICIAN and a CASHIER in their own branch", async () => {
      for (const role of ["DRIVER", "TECHNICIAN", "CASHIER"]) {
        const { reply } = await addMember(adminDouala, role, [douala]);
        expect(reply.status, role).toBe(200);
      }
    });

    it("may not give any other role", async () => {
      for (const role of ["DIRECTOR", "ADMIN", "FINANCE"]) {
        const { reply } = await addMember(adminDouala, role, role === "DIRECTOR" ? "ALL" : [douala]);
        expect(reply.status, role).toBe(403);
        expect(reply.body.error?.code, role).toBe("MEMBER_ROLE_NOT_GRANTABLE");
      }
    });

    it("may not reach outside their branches, nor hand out every branch", async () => {
      for (const scope of [[yaounde], [douala, yaounde], "ALL"]) {
        const { reply } = await addMember(adminDouala, "DRIVER", scope);
        expect(reply.status).toBe(403);
        expect(reply.body.error?.code).toBe("MEMBER_BRANCH_OUT_OF_SCOPE");
      }
    });

    it("may not touch a FINANCE member, whatever the command", async () => {
      const { principalId } = await addMember(director, "FINANCE", [douala]);
      const replies = [
        await updateRole(adminDouala, principalId, { role: "DRIVER" }),
        await api.send(adminDouala.token, "reset-member-pin", { principalId, pin: "1111" }),
        await api.send(adminDouala.token, "deactivate-member", { principalId }),
      ];
      for (const reply of replies) {
        expect(reply.status).toBe(403);
        expect(reply.body.error?.code).toBe("MEMBER_ROLE_NOT_GRANTABLE");
      }
      expect((await membership(principalId)).deactivatedAt).toBeNull();
    });

    it("may not promote a driver past the field roles", async () => {
      const { principalId } = await addMember(adminDouala, "DRIVER", [douala]);
      const reply = await updateRole(adminDouala, principalId, { role: "ADMIN" });
      expect(reply.status).toBe(403);
      expect(reply.body.error?.code).toBe("MEMBER_ROLE_NOT_GRANTABLE");
      expect((await membership(principalId)).role).toBe("DRIVER");
    });

    it("moves a driver between field roles, resets the PIN, deactivates and reactivates", async () => {
      const { principalId } = await addMember(adminDouala, "DRIVER", [douala]);
      expect((await updateRole(adminDouala, principalId, { role: "CASHIER" })).status).toBe(200);
      expect((await api.send(adminDouala.token, "reset-member-pin", { principalId, pin: "2468" })).status).toBe(200);
      expect((await api.send(adminDouala.token, "deactivate-member", { principalId })).status).toBe(200);
      expect((await api.send(adminDouala.token, "reactivate-member", { principalId })).status).toBe(200);
      expect((await membership(principalId)).role).toBe("CASHIER");
    });

    it("may not manage a driver of another branch, nor move one there", async () => {
      const { principalId: elsewhere } = await addMember(director, "DRIVER", [yaounde]);
      const reset = await api.send(adminDouala.token, "reset-member-pin", { principalId: elsewhere, pin: "1357" });
      expect(reset.status).toBe(403);
      expect(reset.body.error?.code).toBe("MEMBER_BRANCH_OUT_OF_SCOPE");

      const { principalId: mine } = await addMember(adminDouala, "DRIVER", [douala]);
      const move = await updateRole(adminDouala, mine, { branchScope: [yaounde] });
      expect(move.status).toBe(403);
      expect(move.body.error?.code).toBe("MEMBER_BRANCH_OUT_OF_SCOPE");
    });

    it("cannot change their own role or branches", async () => {
      const reply = await updateRole(adminDouala, adminDouala.principalId, { branchScope: "ALL" });
      expect(reply.status).toBe(422);
      expect(reply.body.error?.code).toBe("SELF_ROLE_CHANGE");
    });
  });

  it("refuses every other role outright", async () => {
    const { reply } = await addMember(finance, "DRIVER", [douala]);
    expect(reply.status).toBe(403);
    expect(reply.body.error?.code).toBe("ROLE_FORBIDDEN");
  });

  it("v1 still adds a member, reading the legacy code as the role it became", async () => {
    const { reply, principalId } = await addMember(director, "OPS_MANAGER", [douala], 1);
    expect(reply.status).toBe(200);
    expect((await membership(principalId)).role).toBe("ADMIN");
    const refused = await addMember(director, "CASHIER", [douala], 1);
    expect(refused.reply.status).toBe(400);
  });
});
