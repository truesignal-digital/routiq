import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession, loginWithPin } from "../auth/local.js";
import { auditEvents, commands, credentials, memberships, principals, sessions } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import { REDACTED_PIN } from "./redaction.js";

/**
 * Day-2 member administration. The invariants under test are the ones that
 * decide whether a revoked member can still work and whether a workspace can be
 * locked out of itself — everything else here is ordinary command plumbing.
 */
describe("member commands", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceSlug: string;
  let workspaceId: string;
  let branchId: string;
  let adminPrincipalId: string;
  let adminToken: string;
  let opsToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    workspaceSlug = `ws-members-${randomUUID().slice(0, 8)}`;
    const seeded = await seedWorkspace(ctx.db, workspaceSlug);
    workspaceId = seeded.workspace.id;
    branchId = seeded.branch.id;

    const admin = await seedMember(ctx.db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    adminPrincipalId = admin.principal.id;
    adminToken = (
      await createSession(ctx.db, { workspaceId, principalId: adminPrincipalId })
    ).token;

    // A second admin, so the last-admin invariant does not fire on every test
    // that touches the first one.
    await seedMember(ctx.db, { workspaceId, role: "ADMIN", allBranches: true });

    const ops = await seedMember(ctx.db, {
      workspaceId,
      role: "OPS_MANAGER",
      allBranches: true,
    });
    opsToken = (
      await createSession(ctx.db, { workspaceId, principalId: ops.principal.id })
    ).token;
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function send(
    name: string,
    payload: Record<string, unknown>,
    options: { token?: string; expectedVersion?: number; idempotencyKey?: string } = {},
  ) {
    return ctx.app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${options.token ?? adminToken}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: options.idempotencyKey ?? `idem-${randomUUID()}`,
          origin: "HUMAN_UI",
          ...(options.expectedVersion === undefined
            ? {}
            : { expectedVersion: options.expectedVersion }),
        },
        payload,
      },
    });
  }

  /** A fresh member, since most cases need one they are free to break. */
  async function addMember(
    overrides: Partial<{
      principalId: string;
      displayName: string;
      username: string;
      pin: string;
      role: string;
      branchScope: unknown;
    }> = {},
  ) {
    const principalId = overrides.principalId ?? randomUUID();
    const username = overrides.username ?? `user-${randomUUID().slice(0, 8)}`;
    const pin = overrides.pin ?? "4821";
    const response = await send("add-member", {
      principalId,
      displayName: overrides.displayName ?? "Nouveau Membre",
      username,
      pin,
      role: overrides.role ?? "FIELD_SUBMITTER",
      branchScope: overrides.branchScope ?? "ALL",
    });
    return { response, principalId, username, pin };
  }

  describe("add-member.v1", () => {
    it("creates principal, membership and credential in one call", async () => {
      const { response, principalId, username, pin } = await addMember({
        displayName: "Abdoulaye Sanda",
        role: "OPS_MANAGER",
        branchScope: [branchId],
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ recordId: principalId, rowVersion: 1 });

      const [principal] = await ctx.db
        .select()
        .from(principals)
        .where(eq(principals.id, principalId));
      expect(principal).toMatchObject({
        displayName: "Abdoulaye Sanda",
        principalType: "HUMAN",
      });

      const [membership] = await ctx.db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.workspaceId, workspaceId),
            eq(memberships.principalId, principalId),
          ),
        );
      expect(membership).toMatchObject({
        role: "OPS_MANAGER",
        allBranches: false,
        branchIds: [branchId],
        deactivatedAt: null,
        rowVersion: 1,
      });

      // The point of the command: the new member can actually log in.
      const login = await loginWithPin(ctx.db, {
        workspaceSlug,
        username,
        pin,
      });
      expect(login.ok).toBe(true);
    });

    it("refuses a username already taken in the workspace with a stable code", async () => {
      const first = await addMember();
      expect(first.response.statusCode).toBe(200);

      const { response } = await addMember({ username: first.username });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ error: { code: "USERNAME_TAKEN" } });
    });

    it("refuses a branch scope naming a branch outside the workspace", async () => {
      const { response } = await addMember({ branchScope: [randomUUID()] });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: { code: "REFERENCE_NOT_FOUND", metadata: { referenceType: "branch" } },
      });
    });

    it("refuses a non-admin", async () => {
      const forbidden = await send(
        "add-member",
        {
          principalId: randomUUID(),
          displayName: "Refusé",
          username: `user-${randomUUID().slice(0, 8)}`,
          pin: "4821",
          role: "FIELD_SUBMITTER",
          branchScope: "ALL",
        },
        { token: opsToken },
      );
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });
    });

    it("replays an identical retry instead of creating a second member", async () => {
      const principalId = randomUUID();
      const username = `user-${randomUUID().slice(0, 8)}`;
      const key = `idem-${randomUUID()}`;
      const payload = {
        principalId,
        displayName: "Ibrahim Njoya",
        username,
        pin: "4821",
        role: "FIELD_SUBMITTER",
        branchScope: "ALL",
      };

      const first = await send("add-member", payload, { idempotencyKey: key });
      expect(first.statusCode).toBe(200);
      const second = await send("add-member", payload, { idempotencyKey: key });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ recordId: principalId, idempotentReplay: true });

      const rows = await ctx.db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.workspaceId, workspaceId),
            eq(memberships.principalId, principalId),
          ),
        );
      expect(rows).toHaveLength(1);
    });
  });

  describe("PIN redaction", () => {
    it("keeps the PIN out of the receipt, the audit trail and the result", async () => {
      const pin = "13571357";
      const { response, principalId } = await addMember({ pin });
      expect(response.statusCode).toBe(200);
      const commandId = response.json().commandId as string;

      const [receipt] = await ctx.db
        .select({ payload: commands.payload })
        .from(commands)
        .where(eq(commands.id, commandId));
      expect((receipt?.payload as { pin: string }).pin).toBe(REDACTED_PIN);
      expect(JSON.stringify(receipt?.payload)).not.toContain(pin);

      const events = await ctx.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.commandId, commandId));
      expect(events).toHaveLength(1);
      expect(JSON.stringify(events)).not.toContain(pin);

      // Nor the hash: the audit trail records who was added, not their secret.
      const [credential] = await ctx.db
        .select({ pinHash: credentials.pinHash })
        .from(credentials)
        .where(
          and(
            eq(credentials.workspaceId, workspaceId),
            eq(credentials.principalId, principalId),
          ),
        );
      expect(JSON.stringify(events)).not.toContain(credential!.pinHash);
    });

    it("keeps the PIN out of the receipt a rejected call leaves behind", async () => {
      const pin = "24682468";
      const response = await send("add-member", {
        principalId: randomUUID(),
        displayName: "Rejeté",
        username: `user-${randomUUID().slice(0, 8)}`,
        pin,
        role: "FIELD_SUBMITTER",
        branchScope: [randomUUID()],
      });
      expect(response.statusCode).toBe(422);

      const rejected = await ctx.db
        .select({ payload: commands.payload })
        .from(commands)
        .where(eq(commands.status, "REJECTED"));
      expect(JSON.stringify(rejected)).not.toContain(pin);
    });

    it("keeps the PIN out of the receipt when the payload never validated", async () => {
      const pin = "35793579";
      const response = await send("add-member", {
        principalId: "not-a-uuid",
        displayName: "Invalide",
        username: `user-${randomUUID().slice(0, 8)}`,
        pin,
        role: "FIELD_SUBMITTER",
        branchScope: "ALL",
      });
      expect(response.statusCode).toBe(400);

      const rejected = await ctx.db
        .select({ payload: commands.payload })
        .from(commands)
        .where(eq(commands.status, "REJECTED"));
      expect(JSON.stringify(rejected)).not.toContain(pin);
    });

    it("replays a retry of the same call rather than reading the redaction as a different payload", async () => {
      const key = `idem-${randomUUID()}`;
      const payload = {
        principalId: randomUUID(),
        displayName: "Rejouée",
        username: `user-${randomUUID().slice(0, 8)}`,
        pin: "4821",
        role: "FIELD_SUBMITTER",
        branchScope: "ALL",
      };
      expect((await send("add-member", payload, { idempotencyKey: key })).statusCode).toBe(200);
      const replay = await send("add-member", payload, { idempotencyKey: key });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ idempotentReplay: true });
    });
  });

  describe("update-member-role.v1", () => {
    it("changes role and branch scope under the expected version", async () => {
      const { principalId } = await addMember({ role: "FIELD_SUBMITTER" });

      const response = await send(
        "update-member-role",
        { principalId, role: "MAINTENANCE", branchScope: [branchId] },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ recordId: principalId, rowVersion: 2 });

      const [membership] = await ctx.db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.workspaceId, workspaceId),
            eq(memberships.principalId, principalId),
          ),
        );
      expect(membership).toMatchObject({
        role: "MAINTENANCE",
        allBranches: false,
        branchIds: [branchId],
      });

      const [event] = await ctx.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.commandId, response.json().commandId as string));
      expect(event).toMatchObject({
        eventType: "member.role-updated",
        beforeState: { role: "FIELD_SUBMITTER", branchScope: "ALL" },
        afterState: { role: "MAINTENANCE", branchScope: [branchId] },
      });
    });

    it("requires an expected version", async () => {
      const { principalId } = await addMember();
      const response = await send("update-member-role", {
        principalId,
        role: "MAINTENANCE",
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: "EXPECTED_VERSION_REQUIRED" },
      });
    });

    it("refuses a stale expected version", async () => {
      const { principalId } = await addMember();
      const response = await send(
        "update-member-role",
        { principalId, role: "MAINTENANCE" },
        { expectedVersion: 7 },
      );
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: "VERSION_CONFLICT", metadata: { currentVersion: 1 } },
      });
    });

    it("refuses to demote the workspace's last active admin", async () => {
      const lone = await seedWorkspace(ctx.db, `ws-lone-${randomUUID().slice(0, 8)}`);
      const loneAdmin = await seedMember(ctx.db, {
        workspaceId: lone.workspace.id,
        role: "ADMIN",
        allBranches: true,
      });
      const loneToken = (
        await createSession(ctx.db, {
          workspaceId: lone.workspace.id,
          principalId: loneAdmin.principal.id,
        })
      ).token;

      const response = await send(
        "update-member-role",
        { principalId: loneAdmin.principal.id, role: "OPS_MANAGER" },
        { token: loneToken, expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ error: { code: "LAST_ADMIN" } });
    });

    it("allows demoting an admin while another active admin remains", async () => {
      const { principalId } = await addMember({ role: "ADMIN" });
      const response = await send(
        "update-member-role",
        { principalId, role: "OPS_MANAGER" },
        { expectedVersion: 1 },
      );
      expect(response.statusCode).toBe(200);
    });
  });

  describe("deactivate-member.v1", () => {
    it("shuts both doors and drops the member's live sessions", async () => {
      const { principalId, username, pin } = await addMember();
      const memberToken = (
        await createSession(ctx.db, { workspaceId, principalId })
      ).token;

      // Live session before, to prove revocation reaches it.
      const before = await ctx.app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { authorization: `Bearer ${memberToken}` },
      });
      expect(before.statusCode).toBe(200);

      const response = await send("deactivate-member", { principalId });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ recordStatus: "DEACTIVATED" });

      const [membership] = await ctx.db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.workspaceId, workspaceId),
            eq(memberships.principalId, principalId),
          ),
        );
      expect(membership?.deactivatedAt).not.toBeNull();

      const [credential] = await ctx.db
        .select()
        .from(credentials)
        .where(
          and(
            eq(credentials.workspaceId, workspaceId),
            eq(credentials.principalId, principalId),
          ),
        );
      expect(credential?.disabledAt).not.toBeNull();

      const remaining = await ctx.db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.workspaceId, workspaceId),
            eq(sessions.principalId, principalId),
          ),
        );
      expect(remaining).toHaveLength(0);

      // The login boundary.
      const login = await loginWithPin(ctx.db, { workspaceSlug, username, pin });
      expect(login).toMatchObject({ ok: false, code: "AUTH_INVALID_CREDENTIALS" });

      // The authorization boundary: even a token minted after the fact resolves
      // to no context, so the membership itself is what refuses.
      const revived = (await createSession(ctx.db, { workspaceId, principalId })).token;
      const after = await ctx.app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { authorization: `Bearer ${revived}` },
      });
      expect(after.statusCode).toBe(401);
    });

    it("refuses an admin deactivating themselves", async () => {
      const response = await send("deactivate-member", {
        principalId: adminPrincipalId,
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ error: { code: "SELF_DEACTIVATION" } });
    });

    /**
     * The two guards divide the ground completely, which is worth pinning down
     * because it makes LAST_ADMIN unreachable on this command: the caller is
     * always an active admin, so either they are the target (self-guard) or
     * they are themselves the admin that remains. LAST_ADMIN stays in the
     * handler as the backstop that becomes load-bearing the day this command
     * gains a caller who is not the workspace's own admin.
     */
    it("protects the last admin through the self-guard, and allows the case that is safe", async () => {
      const lone = await seedWorkspace(ctx.db, `ws-lone2-${randomUUID().slice(0, 8)}`);
      const first = await seedMember(ctx.db, {
        workspaceId: lone.workspace.id,
        role: "ADMIN",
        allBranches: true,
      });
      const second = await seedMember(ctx.db, {
        workspaceId: lone.workspace.id,
        role: "ADMIN",
        allBranches: true,
      });
      const token = (
        await createSession(ctx.db, {
          workspaceId: lone.workspace.id,
          principalId: first.principal.id,
        })
      ).token;

      // Deactivating the other admin is safe — the caller is still standing.
      const other = await send(
        "deactivate-member",
        { principalId: second.principal.id },
        { token },
      );
      expect(other.statusCode).toBe(200);

      // Now the only active admin left is the caller, and the workspace cannot
      // be emptied of admins.
      const self = await send(
        "deactivate-member",
        { principalId: first.principal.id },
        { token },
      );
      expect(self.statusCode).toBe(422);
      expect(self.json()).toMatchObject({ error: { code: "SELF_DEACTIVATION" } });

      // Nor by the back door: demoting themselves now trips LAST_ADMIN, since
      // the admin they could have handed off to is deactivated.
      const demote = await send(
        "update-member-role",
        { principalId: first.principal.id, role: "OPS_MANAGER" },
        { token, expectedVersion: 1 },
      );
      expect(demote.statusCode).toBe(422);
      expect(demote.json()).toMatchObject({ error: { code: "LAST_ADMIN" } });
    });

    it("refuses to deactivate an already-deactivated member", async () => {
      const { principalId } = await addMember();
      expect((await send("deactivate-member", { principalId })).statusCode).toBe(200);
      const again = await send("deactivate-member", { principalId });
      expect(again.statusCode).toBe(409);
      expect(again.json()).toMatchObject({
        error: { code: "INVALID_STATE_TRANSITION" },
      });
    });
  });

  describe("reactivate-member.v1", () => {
    it("clears both timestamps and lets the member log in again", async () => {
      const { principalId, username, pin } = await addMember();
      expect((await send("deactivate-member", { principalId })).statusCode).toBe(200);

      const response = await send("reactivate-member", { principalId });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ recordStatus: "ACTIVE" });

      const [membership] = await ctx.db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.workspaceId, workspaceId),
            eq(memberships.principalId, principalId),
          ),
        );
      expect(membership?.deactivatedAt).toBeNull();

      const login = await loginWithPin(ctx.db, { workspaceSlug, username, pin });
      expect(login.ok).toBe(true);
    });

    it("refuses to reactivate a member who is already active", async () => {
      const { principalId } = await addMember();
      const response = await send("reactivate-member", { principalId });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: "INVALID_STATE_TRANSITION" },
      });
    });
  });

  describe("reset-member-pin.v1", () => {
    it("replaces the PIN, drops sessions, and never records the value", async () => {
      const { principalId, username, pin } = await addMember();
      const memberToken = (
        await createSession(ctx.db, { workspaceId, principalId })
      ).token;

      const newPin = "86428642";
      const response = await send("reset-member-pin", { principalId, pin: newPin });
      expect(response.statusCode).toBe(200);
      const commandId = response.json().commandId as string;

      expect(await loginWithPin(ctx.db, { workspaceSlug, username, pin })).toMatchObject({
        ok: false,
      });
      expect(
        await loginWithPin(ctx.db, { workspaceSlug, username, pin: newPin }),
      ).toMatchObject({ ok: true });

      const stillValid = await ctx.app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { authorization: `Bearer ${memberToken}` },
      });
      expect(stillValid.statusCode).toBe(401);

      const [receipt] = await ctx.db
        .select({ payload: commands.payload })
        .from(commands)
        .where(eq(commands.id, commandId));
      expect((receipt?.payload as { pin: string }).pin).toBe(REDACTED_PIN);

      const [event] = await ctx.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.commandId, commandId));
      expect(event).toMatchObject({ eventType: "member.pin-reset" });
      expect(JSON.stringify(event)).not.toContain(newPin);
    });

    it("doubles as the unlock verb, clearing a lockout", async () => {
      const { principalId, username } = await addMember();
      const lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      await ctx.db
        .update(credentials)
        .set({ failedAttempts: 5, lockedUntil })
        .where(
          and(
            eq(credentials.workspaceId, workspaceId),
            eq(credentials.principalId, principalId),
          ),
        );

      const newPin = "75317531";
      expect(
        (await send("reset-member-pin", { principalId, pin: newPin })).statusCode,
      ).toBe(200);

      const [credential] = await ctx.db
        .select()
        .from(credentials)
        .where(
          and(
            eq(credentials.workspaceId, workspaceId),
            eq(credentials.principalId, principalId),
          ),
        );
      expect(credential).toMatchObject({ failedAttempts: 0, lockedUntil: null });
      expect(
        await loginWithPin(ctx.db, { workspaceSlug, username, pin: newPin }),
      ).toMatchObject({ ok: true });
    });

    it("refuses a non-admin", async () => {
      const { principalId } = await addMember();
      const response = await send(
        "reset-member-pin",
        { principalId, pin: "11223344" },
        { token: opsToken },
      );
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });
    });
  });

  describe("tenant isolation", () => {
    it("cannot see or touch a member of another workspace", async () => {
      const other = await seedWorkspace(ctx.db, `ws-other-${randomUUID().slice(0, 8)}`);
      const otherMember = await seedMember(ctx.db, {
        workspaceId: other.workspace.id,
        role: "FIELD_SUBMITTER",
        allBranches: true,
      });

      for (const name of ["deactivate-member", "reactivate-member"]) {
        const response = await send(name, { principalId: otherMember.principal.id });
        expect(response.statusCode).toBe(422);
        expect(response.json()).toMatchObject({
          error: { code: "REFERENCE_NOT_FOUND", metadata: { referenceType: "member" } },
        });
      }

      const roleChange = await send(
        "update-member-role",
        { principalId: otherMember.principal.id, role: "ADMIN" },
        { expectedVersion: 1 },
      );
      expect(roleChange.statusCode).toBe(422);

      const pinReset = await send("reset-member-pin", {
        principalId: otherMember.principal.id,
        pin: "99889988",
      });
      expect(pinReset.statusCode).toBe(422);

      // And the other workspace's member is untouched.
      const [membership] = await ctx.db
        .select()
        .from(memberships)
        .where(eq(memberships.principalId, otherMember.principal.id));
      expect(membership).toMatchObject({ role: "FIELD_SUBMITTER", deactivatedAt: null });
    });

    it("lets the same username exist in a different workspace", async () => {
      const username = `shared-${randomUUID().slice(0, 8)}`;
      expect((await addMember({ username })).response.statusCode).toBe(200);

      const other = await seedWorkspace(ctx.db, `ws-dup-${randomUUID().slice(0, 8)}`);
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

      const response = await send(
        "add-member",
        {
          principalId: randomUUID(),
          displayName: "Homonyme",
          username,
          pin: "4821",
          role: "FIELD_SUBMITTER",
          branchScope: "ALL",
        },
        { token: otherToken },
      );
      expect(response.statusCode).toBe(200);
    });
  });
});
