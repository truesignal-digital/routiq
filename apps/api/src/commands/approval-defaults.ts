import type { approvalRules } from "../db/schema.js";

/**
 * Default approval rules for the spine catalog (§5.1).
 * All rules use null filters (wildcards) for category, branch, and amount.
 * These are seeded when a workspace is created; tenants can add custom rules via API later.
 */
export function defaultApprovalRules(
  workspaceId: string,
): (typeof approvalRules.$inferInsert)[] {
  const rules: (typeof approvalRules.$inferInsert)[] = [
    // register-asset: ADMIN and OPS_MANAGER, no filters
    {
      workspaceId,
      commandType: "register-asset",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "ADMIN",
      createdByCommandId: null,
    },
    {
      workspaceId,
      commandType: "register-asset",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "OPS_MANAGER",
      createdByCommandId: null,
    },
    // commission-asset: ADMIN and OPS_MANAGER, no filters
    {
      workspaceId,
      commandType: "commission-asset",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "ADMIN",
      createdByCommandId: null,
    },
    {
      workspaceId,
      commandType: "commission-asset",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "OPS_MANAGER",
      createdByCommandId: null,
    },
    // assign-asset: ADMIN and OPS_MANAGER, no filters
    {
      workspaceId,
      commandType: "assign-asset",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "ADMIN",
      createdByCommandId: null,
    },
    {
      workspaceId,
      commandType: "assign-asset",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "OPS_MANAGER",
      createdByCommandId: null,
    },
    // assign-asset: CROSS_BRANCH requires FINANCE_APPROVER
    {
      workspaceId,
      commandType: "assign-asset",
      categoryCode: "CROSS_BRANCH",
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "FINANCE_APPROVER",
      createdByCommandId: null,
    },
    // enable-module: ADMIN only, no filters
    {
      workspaceId,
      commandType: "enable-module",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "ADMIN",
      createdByCommandId: null,
    },
    // disable-module: ADMIN only, no filters
    {
      workspaceId,
      commandType: "disable-module",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "ADMIN",
      createdByCommandId: null,
    },
    // update-approval-threshold: ADMIN only, no filters
    {
      workspaceId,
      commandType: "update-approval-threshold",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "ADMIN",
      createdByCommandId: null,
    },
    // add-or-renew-document: ADMIN, OPS_MANAGER, FIELD_SUBMITTER, no filters
    {
      workspaceId,
      commandType: "add-or-renew-document",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "ADMIN",
      createdByCommandId: null,
    },
    {
      workspaceId,
      commandType: "add-or-renew-document",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "OPS_MANAGER",
      createdByCommandId: null,
    },
    {
      workspaceId,
      commandType: "add-or-renew-document",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "FIELD_SUBMITTER",
      createdByCommandId: null,
    },
  ];

  for (const commandType of ["record-expense", "record-revenue"]) {
    // All writing roles auto-post through the pilot threshold.
    rules.push(
      ...(["FIELD_SUBMITTER", "OPS_MANAGER", "FINANCE_APPROVER", "ADMIN"] as const).map(
        (requiredRole) => ({
          workspaceId,
          commandType,
          categoryCode: null,
          branchId: null,
          amountMinMinor: null,
          amountMaxMinor: 100_000n,
          requiredRole,
          createdByCommandId: null,
        }),
      ),
    );
    // Finance approvers and admins may auto-post above the threshold too.
    rules.push(
      ...(["FINANCE_APPROVER", "ADMIN"] as const).map((requiredRole) => ({
        workspaceId,
        commandType,
        categoryCode: null,
        branchId: null,
        amountMinMinor: null,
        amountMaxMinor: null,
        requiredRole,
        createdByCommandId: null,
      })),
    );
  }

  for (const commandType of [
    "approve-entry",
    "reject-entry",
    "reverse-entry",
    "lock-period",
    "reopen-period",
  ]) {
    rules.push(
      ...(["FINANCE_APPROVER", "ADMIN"] as const).map((requiredRole) => ({
        workspaceId,
        commandType,
        categoryCode: null,
        branchId: null,
        amountMinMinor: null,
        amountMaxMinor: null,
        requiredRole,
        createdByCommandId: null,
      })),
    );
  }

  return rules;
}
