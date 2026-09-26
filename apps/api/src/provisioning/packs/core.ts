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
    // MAINTENANCE records expenses only, and only against a work order (the
    // handler enforces that), inside the same band as the field submitter.
    const bandedRoles =
      commandType === "record-expense"
        ? (["FIELD_SUBMITTER", "OPS_MANAGER", "FINANCE_APPROVER", "ADMIN", "MAINTENANCE"] as const)
        : (["FIELD_SUBMITTER", "OPS_MANAGER", "FINANCE_APPROVER", "ADMIN"] as const);
    rules.push(
      ...bandedRoles.map((requiredRole) => ({
        commandType,
        categoryCode: null,
        branchId: null,
        amountMinMinor: null,
        amountMaxMinor: 100_000n,
        requiredRole,
        createdByCommandId: null,
      })),
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

  // The workshop reads the odometer when a truck comes in; the handler has
  // always accepted the role, and without this rule every such reading 403'd.
  rules.push({
    commandType: "record-meter-reading",
    categoryCode: null,
    branchId: null,
    amountMinMinor: null,
    amountMaxMinor: null,
    requiredRole: "MAINTENANCE",
    createdByCommandId: null,
  });

  // Maintenance commands: issue reporting, work order management, and asset release.
  // resolve-issue matches report-issue: whoever could report the fault can say
  // it was fixed on the spot.
  for (const commandType of ["report-issue", "resolve-issue"]) {
    rules.push(
      ...(["ADMIN", "OPS_MANAGER", "FIELD_SUBMITTER", "MAINTENANCE"] as const).map(
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

  for (const commandType of [
    "create-work-order",
    "complete-work-order",
    "cancel-work-order",
    "dismiss-issue",
  ]) {
    rules.push(
      ...(["ADMIN", "OPS_MANAGER", "MAINTENANCE"] as const).map((requiredRole) => ({
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

  for (const commandType of ["release-asset-to-service"]) {
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

  // A note is a remark, not a decision: every role that records anything may
  // write one. EXECUTIVE_VIEWER records nothing, notes included.
  rules.push(
    ...(["ADMIN", "OPS_MANAGER", "FIELD_SUBMITTER", "MAINTENANCE", "FINANCE_APPROVER"] as const).map(
      (requiredRole) => ({
        commandType: "add-note",
        categoryCode: null,
        branchId: null,
        amountMinMinor: null,
        amountMaxMinor: null,
        requiredRole,
        createdByCommandId: null,
      }),
    ),
  );

  // The two work-order decisions, on the same footing as approve-entry: what
  // they resolve is money — the expected spend on creation, the declared actual
  // cost on closure — so the finance approver is the role that holds them.
  // No amount bounds, so a workspace that never configures a threshold never
  // meets a pending work order in the first place.
  for (const commandType of [
    "approve-work-order",
    "reject-work-order",
    "approve-work-order-closure",
    "reject-work-order-completion",
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
  return rules;
}

export const corePack: {
  code: "CORE";
  version: 1;
  categories: Array<Omit<typeof categories.$inferInsert, "workspaceId">>;
  approvalRules: Array<Omit<typeof approvalRules.$inferInsert, "workspaceId">>;
} = {
  code: "CORE",
  version: 1,
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
    // Fault types a reporter picks from (#28). `defaultSafetyCritical` only
    // pre-checks the box; the reporter's confirmed flag is what grounds a
    // truck. Mirrored for existing workspaces by migration 0027.
    ...(
      [
        ["BRAKES", "Freins", "Brakes", true],
        ["STEERING", "Direction", "Steering", true],
        ["TYRES", "Pneumatiques", "Tyres", true],
        ["LIGHTING", "Éclairage", "Lighting", false],
        ["ENGINE", "Moteur", "Engine", false],
        ["BODYWORK", "Carrosserie", "Bodywork", false],
        ["OTHER", "Autre", "Other", false],
      ] as const
    ).map(([code, labelFr, labelEn, defaultSafetyCritical]) => ({
      kind: "ISSUE_TYPE" as const,
      code,
      active: true,
      labelFr,
      labelEn,
      defaultSafetyCritical,
    })),
  ],
  approvalRules: defaultApprovalRules(),
};
