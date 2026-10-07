import {
  APPROVAL_CHAIN_COMMAND_TYPES,
  ROLES,
  type ApprovalThresholdsResponse,
} from "@routiq/contracts";
import { and, asc, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { RequireAuth } from "../auth/plugin.js";
import { CEILING_BAND_TYPES, loadApprovalBands, RECORDING_BAND_TYPES } from "../commands/approval-bands.js";
import { chainSteps, entryRecorderRoles, rolesMovedBy } from "../commands/approval-rule-changes.js";
import { loadApprovalRules } from "../commands/approvals.js";
import type { Db } from "../db/client.js";
import {
  approvalRuleChanges,
  approvalRules,
  branches,
  commands,
  principals,
  workspaces,
} from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { defineRead } from "./define-read.js";

const BAND_TYPES = [...RECORDING_BAND_TYPES, ...CEILING_BAND_TYPES];

/** Rules kept to one branch or one category: the bands leave them alone. */
async function overrides(tx: TenantTx, workspaceId: string) {
  const rows = await tx
    .select({
      commandType: approvalRules.commandType,
      branchName: branches.name,
      categoryCode: approvalRules.categoryCode,
      amountMinMinor: approvalRules.amountMinMinor,
      amountMaxMinor: approvalRules.amountMaxMinor,
      requiredRole: approvalRules.requiredRole,
    })
    .from(approvalRules)
    .leftJoin(branches, eq(branches.id, approvalRules.branchId))
    .where(
      and(
        eq(approvalRules.workspaceId, workspaceId),
        inArray(approvalRules.commandType, BAND_TYPES),
        or(isNotNull(approvalRules.branchId), isNotNull(approvalRules.categoryCode)),
      ),
    )
    .orderBy(asc(approvalRules.commandType), asc(branches.name), asc(approvalRules.categoryCode));
  return rows.map((row) => ({
    ...row,
    amountMinMinor: row.amountMinMinor === null ? null : Number(row.amountMinMinor),
    amountMaxMinor: row.amountMaxMinor === null ? null : Number(row.amountMaxMinor),
  }));
}

/** The latest change to the chain, named like the notice names it (#422). */
async function lastChange(tx: TenantTx, workspaceId: string) {
  const [latest] = await tx
    .select({ changedAt: approvalRuleChanges.changedAt, changedBy: principals.displayName })
    .from(approvalRuleChanges)
    .leftJoin(
      commands,
      and(
        eq(commands.workspaceId, approvalRuleChanges.workspaceId),
        eq(commands.id, approvalRuleChanges.createdByCommandId),
      ),
    )
    .leftJoin(principals, eq(principals.id, commands.tenantActorPrincipalId))
    .where(eq(approvalRuleChanges.workspaceId, workspaceId))
    .orderBy(desc(approvalRuleChanges.changedAt), desc(approvalRuleChanges.id))
    .limit(1);
  return latest === undefined
    ? null
    : { changedAt: latest.changedAt.toISOString(), changedBy: latest.changedBy };
}

/**
 * `GET /v1/approval-thresholds` (#354): the Company settings view of the
 * money chain, Direction's alone like the command that moves it. The chain is
 * about money entries, so with the Finance module off there is nothing to set.
 */
export function registerApprovalThresholdsReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  defineRead(
    app,
    { db, requireAuth },
    {
      path: "/v1/approval-thresholds",
      module: "FINANCE",
      roles: ["DIRECTOR"],
      branchScope: "workspace",
    },
    async ({ auth, read }): Promise<ApprovalThresholdsResponse> =>
      read(async (tx) => {
        const [workspace] = await tx
          .select({ currency: workspaces.defaultCurrency })
          .from(workspaces)
          .where(eq(workspaces.id, auth.workspaceId));
        const bands = await loadApprovalBands(tx, auth.workspaceId);

        const decisionRules = await loadApprovalRules(tx, auth.workspaceId, "approve-entry");
        const recordRules = new Map(
          await Promise.all(
            APPROVAL_CHAIN_COMMAND_TYPES.map(
              async (commandType) =>
                [commandType, await loadApprovalRules(tx, auth.workspaceId, commandType)] as const,
            ),
          ),
        );
        const roles = ROLES.flatMap((role) => {
          const chains = APPROVAL_CHAIN_COMMAND_TYPES.filter((commandType) =>
            entryRecorderRoles(commandType).includes(role),
          ).map((commandType) => ({
            commandType,
            steps: chainSteps(recordRules.get(commandType) ?? [], decisionRules, role),
          }));
          return chains.length === 0 ? [] : [{ role, chains }];
        });

        return {
          currency: workspace?.currency ?? "XAF",
          version: bands.version,
          recordingThresholdMinor:
            bands.recordingThresholdMinor === null ? null : Number(bands.recordingThresholdMinor),
          financeCeilingMinor:
            bands.financeCeilingMinor === null ? null : Number(bands.financeCeilingMinor),
          roles,
          overrides: await overrides(tx, auth.workspaceId),
          affectedRoles: rolesMovedBy(BAND_TYPES),
          lastChange: await lastChange(tx, auth.workspaceId),
        };
      }),
  );
}
