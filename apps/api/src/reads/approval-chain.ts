import {
  APPROVAL_CHAIN_COMMAND_TYPES,
  type ApprovalChainResponse,
  type ApprovalRulesNotice,
} from "@routiq/contracts";
import { and, arrayContains, desc, eq, gte, isNull, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { RequireAuth } from "../auth/plugin.js";
import type { AuthContext } from "../auth/types.js";
import { chainSteps, entryRecorderRoles } from "../commands/approval-rule-changes.js";
import { loadApprovalRules } from "../commands/approvals.js";
import type { Db } from "../db/client.js";
import {
  approvalRuleAcknowledgements,
  approvalRuleChanges,
  commands,
  memberships,
  principals,
  workspaces,
} from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { ANY_ROLE, defineRead } from "./define-read.js";

/**
 * The latest approval-rule change that moved the caller's role, unless they
 * have acknowledged it (#422). Only the latest: a member back after several
 * changes reads the current rules once. Changes made before the member joined
 * are not theirs to be told about, and nobody is told about their own change.
 * Who made it is masked like history's actors: a platform receipt names no one.
 */
async function pendingNotice(tx: TenantTx, auth: AuthContext): Promise<ApprovalRulesNotice | null> {
  const [membership] = await tx
    .select({ createdAt: memberships.createdAt })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, auth.workspaceId), eq(memberships.id, auth.membershipId)));
  if (!membership) return null;

  const [latest] = await tx
    .select({
      id: approvalRuleChanges.id,
      changedAt: approvalRuleChanges.changedAt,
      changedBy: principals.displayName,
    })
    .from(approvalRuleChanges)
    .leftJoin(
      commands,
      and(
        eq(commands.workspaceId, approvalRuleChanges.workspaceId),
        eq(commands.id, approvalRuleChanges.createdByCommandId),
      ),
    )
    .leftJoin(principals, eq(principals.id, commands.tenantActorPrincipalId))
    .where(
      and(
        eq(approvalRuleChanges.workspaceId, auth.workspaceId),
        arrayContains(approvalRuleChanges.affectedRoles, [auth.role]),
        gte(approvalRuleChanges.changedAt, membership.createdAt),
        or(
          isNull(approvalRuleChanges.createdByCommandId),
          ne(commands.initiatedByPrincipalId, auth.principalId),
        ),
      ),
    )
    .orderBy(desc(approvalRuleChanges.changedAt), desc(approvalRuleChanges.id))
    .limit(1);
  if (!latest) return null;

  const [acknowledged] = await tx
    .select({ one: sql<number>`1` })
    .from(approvalRuleAcknowledgements)
    .where(
      and(
        eq(approvalRuleAcknowledgements.workspaceId, auth.workspaceId),
        eq(approvalRuleAcknowledgements.membershipId, auth.membershipId),
        eq(approvalRuleAcknowledgements.changeId, latest.id),
      ),
    );
  if (acknowledged) return null;

  return {
    changeId: latest.id,
    changedAt: latest.changedAt.toISOString(),
    changedBy: latest.changedBy,
  };
}

/**
 * `GET /v1/approval-chain`: what happens to the caller's own entries at each
 * amount, per entry kind they may record, and the rules notice they have not
 * dismissed. Core, like the approval settings it explains; the chain is about
 * money entries, so with the Finance module off there is nothing to tell.
 */
export function registerApprovalChainReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/approval-chain", module: "CORE", roles: ANY_ROLE, branchScope: "workspace" },
    async ({ auth, modules, read }): Promise<ApprovalChainResponse> =>
      read(async (tx) => {
        const [workspace] = await tx
          .select({ currency: workspaces.defaultCurrency })
          .from(workspaces)
          .where(eq(workspaces.id, auth.workspaceId));
        const currency = workspace?.currency ?? "XAF";
        if (!modules.has("FINANCE")) return { currency, chains: [], notice: null };

        const decisionRules = await loadApprovalRules(tx, auth.workspaceId, "approve-entry");
        const chains = [];
        for (const commandType of APPROVAL_CHAIN_COMMAND_TYPES) {
          if (!entryRecorderRoles(commandType).includes(auth.role)) continue;
          const recordRules = await loadApprovalRules(tx, auth.workspaceId, commandType);
          chains.push({ commandType, steps: chainSteps(recordRules, decisionRules, auth.role) });
        }
        return { currency, chains, notice: await pendingNotice(tx, auth) };
      }),
  );
}
