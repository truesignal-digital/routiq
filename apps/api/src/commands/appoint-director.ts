import { appointDirectorPayload, type AppointDirectorPayload } from "@routiq/contracts";
import { and, eq, sql } from "drizzle-orm";
import { credentials, memberships, workspaces } from "../db/schema.js";
import {
  appendPlatformAuditEvent,
  CommandError,
  registerPlatformCommand,
} from "./dispatcher.js";
import { MEMBER_ADMIN_LOCK_CLASS } from "./members.js";

/**
 * The vendor operator's way to give a workspace its DIRECTOR (ADR-0009). No
 * tenant role may grant Direction to someone who does not hold it, and the
 * role migration left every existing workspace without one, so the first is
 * appointed from outside the tenant, through the same pipeline (receipt,
 * idempotency, audit) as provisioning. Run it with `scripts/appoint-director.ts`.
 *
 * Takes the workspace member lock that member administration takes, so an
 * appointment cannot interleave with a role change being made in the app.
 */
registerPlatformCommand<AppointDirectorPayload>({
  scope: "platform",
  name: "appoint-director",
  version: 1,
  payloadSchema: appointDirectorPayload,

  async resolveWorkspace(tx, _ctx, _envelope, payload) {
    const [workspace] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, payload.workspaceSlug))
      .limit(1);
    if (!workspace) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "workspace",
        referenceCode: payload.workspaceSlug,
      });
    }
    return workspace.id;
  },

  async execute(tx, ctx, envelope, payload, workspaceId) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${MEMBER_ADMIN_LOCK_CLASS}, hashtext(${workspaceId}))`,
    );

    const [member] = await tx
      .select({ membership: memberships })
      .from(credentials)
      .innerJoin(
        memberships,
        and(
          eq(memberships.workspaceId, credentials.workspaceId),
          eq(memberships.principalId, credentials.principalId),
        ),
      )
      .where(and(eq(credentials.workspaceId, workspaceId), eq(credentials.username, payload.username)))
      .limit(1);
    if (!member) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "member",
        referenceCode: payload.username,
      });
    }
    const before = member.membership;
    if (before.deactivatedAt !== null) {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", { from: "DEACTIVATED", to: "DIRECTOR" });
    }
    if (before.role === "DIRECTOR") {
      throw new CommandError(409, "INVALID_STATE_TRANSITION", { from: "DIRECTOR", to: "DIRECTOR" });
    }

    const [after] = await tx
      .update(memberships)
      .set({
        role: "DIRECTOR",
        allBranches: true,
        branchIds: [],
        rowVersion: sql`${memberships.rowVersion} + 1`,
      })
      .where(eq(memberships.id, before.id))
      .returning();
    if (!after) throw new Error("memberships update returned no row");

    await appendPlatformAuditEvent(tx, ctx, workspaceId, envelope, {
      eventType: "member.director-appointed",
      entityType: "membership",
      entityId: before.principalId,
      beforeState: {
        role: before.role,
        branchScope: before.allBranches ? "ALL" : before.branchIds,
      },
      afterState: { role: "DIRECTOR", branchScope: "ALL" },
      changedFields: ["role", "branchScope"],
    });

    return { recordId: before.principalId, rowVersion: after.rowVersion };
  },
});
