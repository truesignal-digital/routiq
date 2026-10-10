import type { EntryApprover } from "@routiq/contracts";
import { and, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { AuthContext } from "../auth/types.js";
import { commands, financialEntries, memberships } from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { entryDecider } from "../commands/approval-rule-changes.js";
import { loadApprovalRules, matchApproval } from "../commands/approvals.js";

/**
 * What "waiting for approval" means, in one place: SUBMITTED entries inside the
 * caller's branch scope. `/v1/finance/approvals` lists and totals them and
 * `/v1/dashboard` counts them — a second copy of this predicate is how the
 * dashboard card and the queue end up showing different numbers.
 *
 * Scope comes from the session (ADR-0003). The optional `branchId` is the
 * client's own narrowing, applied on top of that scope and never instead of it.
 */
export function pendingApprovalConditions(
  auth: AuthContext,
  branchId?: string,
): SQL[] {
  const conditions: SQL[] = [
    eq(financialEntries.workspaceId, auth.workspaceId),
    eq(financialEntries.status, "SUBMITTED"),
  ];

  if (auth.branchScope !== "ALL") {
    conditions.push(inArray(financialEntries.branchId, auth.branchScope));
  }
  if (branchId !== undefined) {
    conditions.push(eq(financialEntries.branchId, branchId));
  }

  return conditions;
}

/**
 * How much pending work a `branchId` narrowing leaves out — the complement of
 * the narrowing above, counted. Zero without one: the queue already spans
 * everything the caller can decide.
 *
 * Work outside `auth.branchScope` is never counted. The client could not widen
 * to it, so offering the number would name work it can never reach.
 *
 * The queue read and the dashboard card both call this rather than each running
 * their own count, so the two can never disagree about what the lens hides.
 */
export async function countPendingOutsideBranch(
  tx: TenantTx,
  auth: AuthContext,
  branchId: string | undefined,
): Promise<number> {
  if (branchId === undefined) return 0;

  const [row] = await tx
    .select({ count: sql<number>`count(*)::integer` })
    .from(financialEntries)
    .where(
      and(
        ...pendingApprovalConditions(auth),
        ne(financialEntries.branchId, branchId),
      ),
    );

  return row?.count ?? 0;
}

/**
 * Per entry: whether the approval chain keeps the viewer's role from deciding
 * it, so Direction decides (ADR-0009). The same rules and matching
 * approve-entry runs, so the screen never offers a decision the command
 * refuses. Only SUBMITTED entries can be true, and only for a role the entry
 * chain names at all.
 */
export async function directionDecidesEntries(
  tx: TenantTx,
  auth: AuthContext,
  entries: ReadonlyArray<{ status: string; branchId: string; amountMinor: bigint }>,
): Promise<boolean[]> {
  if (!entries.some((entry) => entry.status === "SUBMITTED")) return entries.map(() => false);
  const rules = await loadApprovalRules(tx, auth.workspaceId, "approve-entry");
  if (!rules.some((rule) => rule.requiredRole === auth.role)) return entries.map(() => false);
  return entries.map(
    (entry) =>
      entry.status === "SUBMITTED" &&
      matchApproval(rules, auth.role, {
        branchId: entry.branchId,
        amountMinor: entry.amountMinor < 0n ? -entry.amountMinor : entry.amountMinor,
      }).outcome === "APPROVAL_REQUIRED",
  );
}

/**
 * The waiting entries this caller can decide: the queue less their own
 * submissions (maker-checker) and less the entries above their band (Direction
 * decides). The Money badge and the Money page's waiting tile both count this
 * list, so the two cannot disagree (#542).
 */
export async function decidablePendingEntries(tx: TenantTx, auth: AuthContext, branchId?: string) {
  const pending = await tx
    .select({
      status: financialEntries.status,
      branchId: financialEntries.branchId,
      amountMinor: financialEntries.amountMinor,
      currency: financialEntries.currency,
      submittedAt: financialEntries.createdAt,
      submittedBy: commands.initiatedByPrincipalId,
    })
    .from(financialEntries)
    .innerJoin(
      commands,
      and(
        eq(commands.workspaceId, financialEntries.workspaceId),
        eq(commands.id, financialEntries.createdByCommandId),
      ),
    )
    .where(and(...pendingApprovalConditions(auth, branchId)));
  const directionDecides = await directionDecidesEntries(tx, auth, pending);
  return pending.filter(
    (entry, index) => entry.submittedBy !== auth.principalId && directionDecides[index] !== true,
  );
}

/**
 * Per entry: who decides it while it waits, or null once it no longer waits.
 * Unlike `directionDecidesEntries` this does not depend on the viewer: it
 * names the chain's decider at the entry's amount and branch, and a Finance
 * colleague when a Finance member recorded it (#542).
 */
export async function entryApprovers(
  tx: TenantTx,
  workspaceId: string,
  entries: ReadonlyArray<{
    status: string;
    branchId: string;
    amountMinor: bigint;
    createdByCommandId: string;
  }>,
): Promise<Array<EntryApprover | null>> {
  const waiting = entries.filter((entry) => entry.status === "SUBMITTED");
  if (waiting.length === 0) return entries.map(() => null);
  const rules = await loadApprovalRules(tx, workspaceId, "approve-entry");
  const makers = await tx
    .select({ commandId: commands.id, role: memberships.role })
    .from(commands)
    .innerJoin(
      memberships,
      and(
        eq(memberships.workspaceId, commands.workspaceId),
        eq(memberships.principalId, commands.tenantActorPrincipalId),
      ),
    )
    .where(
      and(
        eq(commands.workspaceId, workspaceId),
        inArray(commands.id, [...new Set(waiting.map((entry) => entry.createdByCommandId))]),
      ),
    );
  const makerRole = new Map(makers.map((maker) => [maker.commandId, maker.role]));
  return entries.map((entry) =>
    entry.status === "SUBMITTED"
      ? entryDecider(rules, makerRole.get(entry.createdByCommandId) ?? null, {
          branchId: entry.branchId,
          amountMinor: entry.amountMinor < 0n ? -entry.amountMinor : entry.amountMinor,
        })
      : null,
  );
}
