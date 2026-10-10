import type { Role } from "@routiq/contracts";
import { and, asc, eq } from "drizzle-orm";
import type { AuthContext } from "../src/auth/types.js";
import { resolveAuthContext } from "../src/auth/context.js";
import { authDb, db } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { dispatchCommand, type CommandOutcome } from "../src/commands/dispatcher.js";
import { currentBusinessDate } from "../src/reads/business-date.js";
import { appointDirector } from "./appoint-director.js";
import { deterministicProvisionId, provisionTenant } from "./provision.js";

/**
 * Both demo companies are in Cameroon, which keeps UTC+1 all year, so a fixed
 * offset turns a local wall-clock time into an exact instant.
 */
export const demoTimezone = "Africa/Douala";
export const demoUtcOffset = "+01:00";

export interface DemoUser {
  id: string;
  username: string;
  displayName: string;
  pin: string;
  role: Role;
}

export interface AddedMember extends DemoUser {
  /** `ALL`, or the branches the member is scoped to. */
  branches: "ALL" | Array<{ id: string; code: string }>;
}

export interface RunOptions {
  expectedVersion?: number;
  clientOccurredAt?: string;
  version?: number;
}

/**
 * The plumbing every demo workspace's seed shares, bound to one slug. Ids and
 * idempotency keys are derived from the slug and a step name, so the same step
 * in the same workspace always carries the same identity: that is what makes a
 * re-seed a replay rather than a second copy.
 */
export function demoKit(slug: string) {
  const id = (name: string) => deterministicProvisionId(`seed-demo:${slug}:${name}`);
  const workspaceId = id("workspace");
  const commandId = (name: string) => id(`command:${name}`);
  const idempotencyKey = (name: string) => `seed-demo:${slug}:${name}`;

  async function existingWorkspaceId(): Promise<string | undefined> {
    const [workspace] = await authDb
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.slug, slug))
      .limit(1);
    return workspace?.id;
  }

  /**
   * Provisioning is skipped, not replayed, when the workspace is already there.
   * Its idempotency key moved to `provision-workspace.v2` with issue #20 (and
   * `.v3` with ADR-0009), so a workspace provisioned under the old key finds no
   * receipt: the command re-executes and answers 409 DUPLICATE_WORKSPACE_SLUG.
   * Every demo seeded before that bump — the deployed one included — is in
   * exactly that state, so it is the existence check rather than the receipt
   * that lets a re-seed reach the commands after it.
   */
  async function provisionOnce(tenant: unknown, provisionKey: string): Promise<void> {
    const existing = await existingWorkspaceId();
    if (existing === workspaceId) {
      console.log(`Already provisioned: workspace id=${existing} slug=${slug}`);
      return;
    }
    if (existing !== undefined) {
      throw new Error(
        `Workspace "${slug}" exists under id ${existing}, not the deterministic ${workspaceId}; refusing to seed into it.`,
      );
    }
    await provisionTenant(tenant, console.log, {
      commandId: commandId("provision-workspace"),
      idempotencyKey: idempotencyKey(provisionKey),
    });
  }

  /**
   * A demo seeded before ADR-0009 was migrated with no DIRECTOR; the vendor
   * path gives the first account the role a fresh provisioning gives it.
   */
  async function ensureDirector(principalId: string, username: string): Promise<void> {
    const [membership] = await authDb
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.workspaceId, workspaceId),
          eq(schema.memberships.principalId, principalId),
        ),
      );
    if (membership?.role !== "DIRECTOR") {
      await appointDirector(slug, username, console.log);
    }
  }

  async function actor(principalId: string): Promise<AuthContext> {
    const context = await resolveAuthContext(authDb, { workspaceId, principalId });
    if (!context) throw new Error(`Unable to resolve demo user ${principalId} in ${slug}`);
    return context;
  }

  async function runCommand(
    context: AuthContext,
    operation: string,
    payload: unknown,
    options: RunOptions = {},
  ): Promise<CommandOutcome | undefined> {
    const name = operation.split(":", 1)[0]!;
    const result = await dispatchCommand(db, context, {
      name,
      version: options.version ?? 1,
      envelope: {
        commandId: commandId(operation),
        idempotencyKey: idempotencyKey(operation),
        origin: "API",
        ...(options.expectedVersion === undefined
          ? {}
          : { expectedVersion: options.expectedVersion }),
        ...(options.clientOccurredAt === undefined
          ? {}
          : { clientOccurredAt: options.clientOccurredAt }),
      },
      payload,
    });
    if ("error" in result.body) {
      /**
       * A reused key means this step already ran, under a payload that has since
       * been edited in a seed file — `close: true` joined the Garoua sheet after
       * the demo was first seeded, and a re-seed has met a 409 there ever since.
       * The step is done: the record it wrote is the one the demo has been
       * telling its story about, and rewriting it is precisely what a re-seed
       * must not do. So it is skipped loudly rather than fatally, and the
       * commands added after it still get their turn.
       */
      if (result.body.error.code === "IDEMPOTENCY_KEY_REUSED") {
        console.warn(
          `Skipped ${slug} ${operation}: already seeded under an earlier version of its payload.`,
        );
        return undefined;
      }
      throw new Error(
        `${slug} ${operation} failed (${result.status} ${result.body.error.code}): ${JSON.stringify(result.body.error.metadata ?? {})}`,
      );
    }
    return result.body;
  }

  /**
   * A story is dated relative to the day it was first seeded (DECISIONS 6), so
   * "expired three days ago" is true on the day it is shown. The anchor is read
   * back from the first dated command's receipt: a re-seed on a later day then
   * sends the same payloads again and replays, where anchoring on today would
   * change every dated payload and meet IDEMPOTENCY_KEY_REUSED. `--reset`
   * deletes that receipt, so a fresh seed re-anchors on today.
   */
  async function storyToday(anchorOperation: string): Promise<string> {
    const [receipt] = await authDb
      .select({ executedAt: schema.commands.executedAt })
      .from(schema.commands)
      .where(
        and(
          eq(schema.commands.workspaceId, workspaceId),
          eq(schema.commands.idempotencyKey, idempotencyKey(anchorOperation)),
          eq(schema.commands.status, "EXECUTED"),
        ),
      )
      .limit(1);
    return currentBusinessDate(receipt?.executedAt ?? new Date(), demoTimezone);
  }

  async function assetState(assetId: string) {
    const [asset] = await authDb
      .select({
        lifecycleStatus: schema.assets.lifecycleStatus,
        registrationNumber: schema.assets.registrationNumber,
        rowVersion: schema.assets.rowVersion,
      })
      .from(schema.assets)
      .where(and(eq(schema.assets.workspaceId, workspaceId), eq(schema.assets.id, assetId)));
    if (!asset) throw new Error(`Asset ${assetId} is missing`);
    return asset;
  }

  async function assetRowVersion(assetId: string): Promise<number> {
    return (await assetState(assetId)).rowVersion;
  }

  async function activityState(activityId: string) {
    const [activity] = await authDb
      .select({
        status: schema.activities.status,
        completeness: schema.activities.completeness,
        rowVersion: schema.activities.rowVersion,
      })
      .from(schema.activities)
      .where(
        and(eq(schema.activities.workspaceId, workspaceId), eq(schema.activities.id, activityId)),
      );
    if (!activity) throw new Error(`Activity ${activityId} is missing`);
    return activity;
  }

  async function workOrderRowVersion(workOrderId: string): Promise<number> {
    const [workOrder] = await authDb
      .select({ rowVersion: schema.workOrders.rowVersion })
      .from(schema.workOrders)
      .where(
        and(
          eq(schema.workOrders.workspaceId, workspaceId),
          eq(schema.workOrders.id, workOrderId),
        ),
      );
    if (!workOrder) throw new Error(`Work order ${workOrderId} is missing`);
    return workOrder.rowVersion;
  }

  /**
   * Gives a person their login through link-person-login (#569), as the
   * member administrator `admin`, at the person's current version. A person
   * already linked to that login is left alone, so a re-seed adds nothing.
   */
  async function linkPersonLogin(
    admin: AuthContext,
    operation: string,
    personId: string,
    principalId: string,
  ): Promise<void> {
    const [person] = await authDb
      .select({ membershipId: schema.persons.membershipId, rowVersion: schema.persons.rowVersion })
      .from(schema.persons)
      .where(and(eq(schema.persons.workspaceId, workspaceId), eq(schema.persons.id, personId)));
    if (!person) throw new Error(`Person ${personId} is missing`);
    const [login] = await authDb
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.workspaceId, workspaceId),
          eq(schema.memberships.principalId, principalId),
        ),
      );
    if (!login) throw new Error(`Login ${principalId} is missing`);
    if (person.membershipId === login.id) return;
    await runCommand(
      admin,
      operation,
      { personId, principalId },
      { expectedVersion: person.rowVersion },
    );
  }

  async function branchCodes(): Promise<string[]> {
    const rows = await authDb
      .select({ code: schema.branches.code })
      .from(schema.branches)
      .where(eq(schema.branches.workspaceId, workspaceId));
    return rows.map((row) => row.code).sort();
  }

  /** Every login in the workspace, read back rather than assembled from the seed's payloads. */
  async function accountsSummary(seeded: readonly DemoUser[]) {
    const pins = new Map(seeded.map((user) => [user.username, user.pin]));
    const codes = new Map(
      (
        await authDb
          .select({ id: schema.branches.id, code: schema.branches.code })
          .from(schema.branches)
          .where(eq(schema.branches.workspaceId, workspaceId))
      ).map((branch) => [branch.id, branch.code]),
    );
    const rows = await authDb
      .select({
        username: schema.credentials.username,
        displayName: schema.principals.displayName,
        role: schema.memberships.role,
        allBranches: schema.memberships.allBranches,
        branchIds: schema.memberships.branchIds,
      })
      .from(schema.memberships)
      .innerJoin(schema.principals, eq(schema.principals.id, schema.memberships.principalId))
      .innerJoin(
        schema.credentials,
        and(
          eq(schema.credentials.workspaceId, schema.memberships.workspaceId),
          eq(schema.credentials.principalId, schema.memberships.principalId),
        ),
      )
      .where(eq(schema.memberships.workspaceId, workspaceId))
      .orderBy(asc(schema.credentials.username));
    return rows.map((row) => ({
      username: row.username,
      displayName: row.displayName,
      role: row.role,
      branchScope: row.allBranches
        ? "ALL"
        : row.branchIds.map((branchId) => codes.get(branchId) ?? branchId),
      pin: pins.get(row.username) ?? null,
    }));
  }

  /** Branches added after provisioning, then members, the way an operator does it from the app. */
  async function addBranchesAndMembers(
    director: AuthContext,
    branches: ReadonlyArray<{ id: string; key: string; code: string; name: string }>,
    members: readonly AddedMember[],
  ): Promise<void> {
    await Promise.all(
      branches.map((branch) =>
        runCommand(director, `create-branch:${branch.key}`, {
          branchId: branch.id,
          code: branch.code,
          name: branch.name,
        }),
      ),
    );
    // After the branches exist: add-member proves every branch id in the scope
    // belongs to this workspace before it writes the membership.
    for (const member of members) {
      await runCommand(
        director,
        `add-member:${member.username}`,
        {
          principalId: member.id,
          displayName: member.displayName,
          username: member.username,
          pin: member.pin,
          role: member.role,
          branchScope:
            member.branches === "ALL" ? "ALL" : member.branches.map((branch) => branch.id),
        },
        { version: 2 },
      );
    }
  }

  return {
    slug,
    workspaceId,
    id,
    idempotencyKey,
    provisionOnce,
    ensureDirector,
    actor,
    runCommand,
    storyToday,
    assetState,
    assetRowVersion,
    activityState,
    workOrderRowVersion,
    linkPersonLogin,
    branchCodes,
    accountsSummary,
    addBranchesAndMembers,
  };
}

export type DemoKit = ReturnType<typeof demoKit>;
