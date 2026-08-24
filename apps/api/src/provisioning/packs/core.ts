import type { approvalRules, categories } from "../../db/schema.js";

function defaultApprovalRules(): Array<
  Omit<typeof approvalRules.$inferInsert, "workspaceId">
> {
  const rules: Array<Omit<typeof approvalRules.$inferInsert, "workspaceId">> = [
    {
      commandType: "register-asset",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "ADMIN",
      createdByCommandId: null,
    },
    {
      commandType: "register-asset",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "OPS_MANAGER",
      createdByCommandId: null,
    },
    {
      commandType: "commission-asset",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "ADMIN",
      createdByCommandId: null,
    },
    {
      commandType: "commission-asset",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "OPS_MANAGER",
      createdByCommandId: null,
    },
    {
      commandType: "assign-asset",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "ADMIN",
      createdByCommandId: null,
    },
    {
      commandType: "assign-asset",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "OPS_MANAGER",
      createdByCommandId: null,
    },
    {
      commandType: "assign-asset",
      categoryCode: "CROSS_BRANCH",
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "FINANCE_APPROVER",
      createdByCommandId: null,
    },
    {
      commandType: "enable-module",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "ADMIN",
      createdByCommandId: null,
    },
    {
      commandType: "disable-module",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "ADMIN",
      createdByCommandId: null,
    },
    {
      commandType: "update-approval-threshold",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "ADMIN",
      createdByCommandId: null,
    },
    {
      commandType: "add-or-renew-document",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "ADMIN",
      createdByCommandId: null,
    },
    {
      commandType: "add-or-renew-document",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "OPS_MANAGER",
      createdByCommandId: null,
    },
    {
      commandType: "add-or-renew-document",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "FIELD_SUBMITTER",
      createdByCommandId: null,
    },
  ];

  // Workspace configuration, ADMIN only — matching each command's allowedRoles
  // and the enable-module/disable-module rows above. An OPS_MANAGER default
  // would be the surprising choice: these edit the vocabulary and the preset set
  // every other role then records against.
  for (const commandType of [
    "create-category",
    "relabel-category",
    "deactivate-category",
    "reactivate-category",
    "set-template-preset",
    "create-branch",
    "rename-branch",
    "set-branch-status",
  ]) {
    rules.push({
      commandType,
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "ADMIN",
      createdByCommandId: null,
    });
  }

  // Member administration, ADMIN only — same reasoning one step further: these
  // decide who holds a role at all, so anyone who could grant themselves one
  // could grant themselves every rule above.
  for (const commandType of [
    "add-member",
    "update-member-role",
    "deactivate-member",
    "reactivate-member",
    "reset-member-pin",
  ]) {
    rules.push({
      commandType,
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "ADMIN",
      createdByCommandId: null,
    });
  }

  for (const commandType of ["record-expense", "record-revenue"]) {
    rules.push(
      ...(["FIELD_SUBMITTER", "OPS_MANAGER", "FINANCE_APPROVER", "ADMIN"] as const).map(
        (requiredRole) => ({
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
    rules.push(
      ...(["FINANCE_APPROVER", "ADMIN"] as const).map((requiredRole) => ({
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

  for (const commandType of ["register-person", "reopen-activity"]) {
    rules.push(
      ...(["ADMIN", "OPS_MANAGER"] as const).map((requiredRole) => ({
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
    "create-activity",
    "record-movement-leg",
    "record-meter-reading",
    "substitute-asset",
    "close-activity",
    "record-journey-sheet",
    "record-haulage-job-sheet",
  ]) {
    rules.push(
      ...(["ADMIN", "OPS_MANAGER", "FIELD_SUBMITTER"] as const).map((requiredRole) => ({
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

  // MAINTENANCE records the costs of its own work orders — same generous auto
  // band as the other recording roles; above it the entry waits SUBMITTED.
  rules.push({
    commandType: "record-expense",
    categoryCode: null,
    branchId: null,
    amountMinMinor: null,
    amountMaxMinor: 100_000n,
    requiredRole: "MAINTENANCE",
    createdByCommandId: null,
  });

  // Issue capture and standalone resolution are facts, auto for every
  // operational role; dismissing someone else's report is a judgement kept
  // from the field submitter.
  for (const commandType of ["report-issue", "resolve-issue"]) {
    rules.push(
      ...(["FIELD_SUBMITTER", "MAINTENANCE", "OPS_MANAGER", "ADMIN"] as const).map(
        (requiredRole) => ({
          commandType,
          categoryCode: null,
          branchId: null,
          amountMinMinor: null,
          amountMaxMinor: null,
          requiredRole,
          createdByCommandId: null,
        }),
      ),
    );
  }

  for (const commandType of ["dismiss-issue", "cancel-work-order"]) {
    rules.push(
      ...(["MAINTENANCE", "OPS_MANAGER", "ADMIN"] as const).map((requiredRole) => ({
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

  /*
   * The generous auto band (#27): create matches on expected cost, complete on
   * the actual posted total. Above the band the WO waits SUBMITTED /
   * COMPLETION_SUBMITTED for approve-work-order; ADMIN stays unbanded, the
   * same shape record-expense gives FINANCE_APPROVER/ADMIN.
   */
  for (const commandType of ["create-work-order", "complete-work-order"]) {
    rules.push(
      ...(["MAINTENANCE", "OPS_MANAGER", "ADMIN"] as const).map((requiredRole) => ({
        commandType,
        categoryCode: null,
        branchId: null,
        amountMinMinor: null,
        amountMaxMinor: 100_000n,
        requiredRole,
        createdByCommandId: null,
      })),
    );
    rules.push({
      commandType,
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole: "ADMIN",
      createdByCommandId: null,
    });
  }

  for (const commandType of ["approve-work-order", "reject-work-order"]) {
    rules.push(
      ...(["OPS_MANAGER", "FINANCE_APPROVER", "ADMIN"] as const).map((requiredRole) => ({
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

  // §5.1: always one human approval — executing the command IS the approval,
  // so the rule authorizes the deciding roles and nobody else.
  rules.push(
    ...(["OPS_MANAGER", "ADMIN"] as const).map((requiredRole) => ({
      commandType: "release-asset-to-service",
      categoryCode: null,
      branchId: null,
      amountMinMinor: null,
      amountMaxMinor: null,
      requiredRole,
      createdByCommandId: null,
    })),
  );

  return rules;
}

export const corePack: {
  code: "CORE";
  version: 2;
  categories: Array<Omit<typeof categories.$inferInsert, "workspaceId">>;
  approvalRules: Array<Omit<typeof approvalRules.$inferInsert, "workspaceId">>;
} = {
  code: "CORE",
  // v2 (maintenance): ISSUE_TYPE categories with safety defaults + the
  // work-order loop's approval rules. Packs never apply retroactively —
  // existing workspaces pick these up by backfill command, not replay.
  version: 2,
  categories: [
    {
      kind: "DOCUMENT_TYPE",
      code: "INSURANCE",
      active: true,
      labelFr: "Assurance",
      labelEn: "Insurance",
    },
    {
      kind: "DOCUMENT_TYPE",
      code: "PERMIT",
      active: true,
      labelFr: "Permis",
      labelEn: "Permit",
    },
    {
      kind: "EXPENSE_CATEGORY",
      code: "FUEL",
      active: true,
      labelFr: "Carburant",
      labelEn: "Fuel",
      profitabilityLayer: "DIRECT",
      evidencePolicy: "RECEIPT_EXPECTED",
    },
    {
      kind: "EXPENSE_CATEGORY",
      code: "REPAIRS",
      active: true,
      labelFr: "Réparations",
      labelEn: "Repairs",
      profitabilityLayer: "MAINTENANCE",
      evidencePolicy: "RECEIPT_EXPECTED",
    },
    {
      kind: "EXPENSE_CATEGORY",
      code: "INSURANCE",
      active: true,
      labelFr: "Assurance",
      labelEn: "Insurance",
      profitabilityLayer: "OWNERSHIP",
      evidencePolicy: "RECEIPT_EXPECTED",
    },
    {
      kind: "EXPENSE_CATEGORY",
      code: "PARKING",
      active: true,
      labelFr: "Stationnement",
      labelEn: "Parking",
      profitabilityLayer: "DIRECT",
      evidencePolicy: "NO_RECEIPT_EXPECTED",
    },
    {
      kind: "EXPENSE_CATEGORY",
      code: "DRIVER_ALLOWANCE",
      active: true,
      labelFr: "Indemnité chauffeur",
      labelEn: "Driver allowance",
      profitabilityLayer: "DIRECT",
      evidencePolicy: "NO_RECEIPT_EXPECTED",
    },
    {
      kind: "EXPENSE_CATEGORY",
      code: "TOLLS",
      active: true,
      labelFr: "Péages",
      labelEn: "Tolls",
      profitabilityLayer: "DIRECT",
      evidencePolicy: "NO_RECEIPT_EXPECTED",
    },
    /*
     * Issue categories (#28): `defaultSafetyCritical` pre-checks the
     * reporter's checkbox — brakes and accidents park the asset unless the
     * reporter says otherwise. Tenant-editable config-as-data, like every
     * other category field.
     */
    {
      kind: "ISSUE_TYPE",
      code: "MECHANICAL",
      active: true,
      labelFr: "Panne mécanique",
      labelEn: "Mechanical fault",
      defaultSafetyCritical: false,
    },
    {
      kind: "ISSUE_TYPE",
      code: "ELECTRICAL",
      active: true,
      labelFr: "Panne électrique",
      labelEn: "Electrical fault",
      defaultSafetyCritical: false,
    },
    {
      kind: "ISSUE_TYPE",
      code: "TIRES",
      active: true,
      labelFr: "Pneus",
      labelEn: "Tires",
      defaultSafetyCritical: false,
    },
    {
      kind: "ISSUE_TYPE",
      code: "BRAKES",
      active: true,
      labelFr: "Freins",
      labelEn: "Brakes",
      defaultSafetyCritical: true,
    },
    {
      kind: "ISSUE_TYPE",
      code: "ACCIDENT",
      active: true,
      labelFr: "Accident",
      labelEn: "Accident",
      defaultSafetyCritical: true,
    },
    {
      kind: "ISSUE_TYPE",
      code: "OTHER",
      active: true,
      labelFr: "Autre",
      labelEn: "Other",
      defaultSafetyCritical: false,
    },
  ],
  approvalRules: defaultApprovalRules(),
};
