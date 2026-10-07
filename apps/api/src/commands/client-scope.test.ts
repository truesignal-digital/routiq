import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { resolveOperatorContext } from "../auth/context.js";
import { platformDb } from "../db/platform.js";
import { branches, commands, persons, principals } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import { dispatchCommand } from "./dispatcher.js";

/**
 * #152: the workspace, the actor and the actor's branch scope come from the
 * session. A request that tries to name them is refused, not quietly stripped,
 * and identity-shaped TARGET ids (the branch being renamed) only ever resolve
 * inside the caller's own workspace.
 */
describe("client-supplied scope", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let home: { workspaceId: string; branchId: string };
  let foreign: { workspaceId: string; branchId: string };
  let directorToken: string;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const a = await seedWorkspace(ctx.db);
    const b = await seedWorkspace(ctx.db);
    home = { workspaceId: a.workspace.id, branchId: a.branch.id };
    foreign = { workspaceId: b.workspace.id, branchId: b.branch.id };
    directorToken = await tokenFor(home.workspaceId, "DIRECTOR");
    adminToken = await tokenFor(home.workspaceId, "ADMIN");
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe("at the command boundary", () => {
    it("refuses a payload naming another workspace and writes nothing anywhere", async () => {
      const personId = randomUUID();
      const commandId = randomUUID();

      const response = await post(
        "register-person",
        { personId, displayName: "Awa Ngono", branchCode: "DLA", workspaceId: foreign.workspaceId },
        { commandId },
      );

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: {
          code: "VALIDATION_FAILED",
          metadata: { issues: [{ code: "unrecognized_keys", path: ["payload", "workspaceId"] }] },
        },
      });
      expect(await ctx.db.select().from(persons).where(eq(persons.id, personId))).toEqual([]);
      expect(await ctx.db.select().from(commands).where(eq(commands.id, commandId))).toEqual([]);
    });

    it("files the same payload without the field in the session's workspace", async () => {
      const personId = randomUUID();

      const response = await post("register-person", {
        personId,
        displayName: "Awa Ngono",
        branchCode: "DLA",
      });

      expect(response.statusCode).toBe(200);
      const [row] = await ctx.db.select().from(persons).where(eq(persons.id, personId));
      expect(row).toMatchObject({ workspaceId: home.workspaceId, branchId: home.branchId });
    });

    it("refuses tenant, actor and authorized-scope fields in the envelope", async () => {
      const response = await post(
        "register-person",
        { personId: randomUUID(), displayName: "Awa Ngono", branchCode: "DLA" },
        {
          extraEnvelope: {
            workspaceId: foreign.workspaceId,
            actorId: randomUUID(),
            authorizedBranchIds: [foreign.branchId],
          },
        },
      );

      expect(response.statusCode).toBe(400);
      expect(issuePaths(response.json())).toEqual([
        ["envelope", "workspaceId"],
        ["envelope", "actorId"],
        ["envelope", "authorizedBranchIds"],
      ]);
    });

    it("refuses an actor id nested inside a payload array", async () => {
      const response = await post("create-activity", {
        activityId: randomUUID(),
        branchCode: "DLA",
        crew: [{ activityPersonId: randomUUID(), personId: randomUUID(), role: "DRIVER", actorId: randomUUID() }],
      });

      expect(response.statusCode).toBe(400);
      expect(issuePaths(response.json())).toEqual([["payload", "crew", 0, "actorId"]]);
    });

    it("refuses a tenant id beside the envelope", async () => {
      const response = await post(
        "register-person",
        { personId: randomUUID(), displayName: "Awa Ngono", branchCode: "DLA" },
        { extraBody: { tenantId: foreign.workspaceId } },
      );

      expect(response.statusCode).toBe(400);
      expect(issuePaths(response.json())).toEqual([["tenantId"]]);
    });

    it("refuses the same fields from a vendor operator's platform command", async () => {
      const [row] = await ctx.db
        .insert(principals)
        .values({ principalType: "VENDOR_OPERATOR", displayName: "vendor-cli" })
        .returning();
      const operator = row && (await resolveOperatorContext(ctx.db, row.id));
      if (!operator) throw new Error("operator context did not resolve");

      const result = await dispatchCommand(platformDb(ctx.db), operator, {
        name: "appoint-director",
        version: 1,
        envelope: { ...envelope(), actorPrincipalId: randomUUID() },
        payload: { workspaceSlug: "anything", username: "anyone" },
      });

      expect(result.status).toBe(400);
      expect(issuePaths(result.body)).toEqual([["envelope", "actorPrincipalId"]]);
    });
  });

  describe("branch ids are targets, never authority", () => {
    it("still creates, renames and deactivates a branch of the caller's workspace", async () => {
      const branchId = randomUUID();
      expect((await post("create-branch", { branchId, code: "KRB", name: "Kribi" })).statusCode).toBe(200);
      expect(
        (await post("rename-branch", { branchId, name: "Kribi Port" }, { expectedVersion: 1 })).statusCode,
      ).toBe(200);
      expect((await post("set-branch-status", { branchId, active: false })).statusCode).toBe(200);

      const [row] = await ctx.db.select().from(branches).where(eq(branches.id, branchId));
      expect(row).toMatchObject({ workspaceId: home.workspaceId, name: "Kribi Port", active: false });
    });

    it("does not find another workspace's branch to rename or deactivate", async () => {
      const rename = await post(
        "rename-branch",
        { branchId: foreign.branchId, name: "Taken over" },
        { expectedVersion: 1 },
      );
      const status = await post("set-branch-status", { branchId: foreign.branchId, active: false });

      for (const response of [rename, status]) {
        expect(response.statusCode).toBe(422);
        expect(response.json()).toMatchObject({
          error: { code: "REFERENCE_NOT_FOUND", metadata: { referenceType: "branch", referenceId: foreign.branchId } },
        });
      }
      const [row] = await ctx.db.select().from(branches).where(eq(branches.id, foreign.branchId));
      expect(row).toMatchObject({ workspaceId: foreign.workspaceId, name: "Douala", active: true, rowVersion: 1 });
    });

    it("cannot create a branch over another workspace's branch id", async () => {
      const response = await post("create-branch", { branchId: foreign.branchId, code: "XYZ", name: "Hijack" });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.statusCode).toBeLessThan(500);
      const [row] = await ctx.db.select().from(branches).where(eq(branches.id, foreign.branchId));
      expect(row).toMatchObject({ workspaceId: foreign.workspaceId, code: "DLA", name: "Douala" });
    });

    it("refuses branch administration to a role that may not do it", async () => {
      const branchId = randomUUID();
      expect((await post("create-branch", { branchId, code: "EDA", name: "Edéa" })).statusCode).toBe(200);

      const rename = await post(
        "rename-branch",
        { branchId, name: "Edéa Centre" },
        { expectedVersion: 1, token: adminToken },
      );

      expect(rename.statusCode).toBe(403);
      expect(rename.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });
    });
  });

  async function tokenFor(workspaceId: string, role: "DIRECTOR" | "ADMIN"): Promise<string> {
    const member = await seedMember(ctx.db, { workspaceId, role, allBranches: true });
    return (await createSession(ctx.db, { workspaceId, principalId: member.principal.id })).token;
  }

  function envelope(overrides: { commandId?: string; expectedVersion?: number } = {}) {
    return {
      commandId: overrides.commandId ?? randomUUID(),
      idempotencyKey: `scope-${randomUUID()}`,
      origin: "HUMAN_UI",
      ...(overrides.expectedVersion === undefined ? {} : { expectedVersion: overrides.expectedVersion }),
    };
  }

  function post(
    name: string,
    payload: Record<string, unknown>,
    opts: {
      commandId?: string;
      expectedVersion?: number;
      token?: string;
      extraEnvelope?: Record<string, unknown>;
      extraBody?: Record<string, unknown>;
    } = {},
  ) {
    return ctx.app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${opts.token ?? directorToken}` },
      payload: {
        version: 1,
        envelope: {
          ...envelope({
            ...(opts.commandId === undefined ? {} : { commandId: opts.commandId }),
            ...(opts.expectedVersion === undefined ? {} : { expectedVersion: opts.expectedVersion }),
          }),
          ...opts.extraEnvelope,
        },
        payload,
        ...opts.extraBody,
      },
    });
  }
});

function issuePaths(body: unknown): unknown[] {
  const issues = (body as { error?: { metadata?: { issues?: { path: unknown }[] } } }).error?.metadata?.issues;
  return (issues ?? []).map((issue) => issue.path);
}
