import type { Role } from "@routiq/contracts";
import type { approvalRules, categories } from "../../db/schema.js";

type ApprovalRuleDefault = Omit<typeof approvalRules.$inferInsert, "workspaceId">;

/** The amount up to which a maker role's money record posts without review. */
const RECORDING_BAND = 100_000n;

/** Rules with no filter: each role runs the command at any amount, in any branch. */
function wildcard(commandTypes: readonly string[], roles: readonly Role[]): ApprovalRuleDefault[] {
  return commandTypes.flatMap((commandType) =>
    roles.map((requiredRole) => ({
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

/** Rules bounded at `amountMaxMinor`: above it, the role's record waits for review. */
function banded(
  commandTypes: readonly string[],
  roles: readonly Role[],
  amountMaxMinor: bigint,
): ApprovalRuleDefault[] {
  return wildcard(commandTypes, roles).map((rule) => ({ ...rule, amountMaxMinor }));
}

/**
 * Catalog approval defaults (§5.1). A role in a command's `allowedRoles` with
 * no matching rule is answered APPROVAL_REQUIRED, so every allowed role has a
 * row here and no other role does (`role-matrix.test.ts`).
 *
 * These are the pre-ADR-0009 defaults put through the role map (migration
 * 0036 does the same to existing workspaces), plus: DIRECTOR on every rule
 * shape, since Direction may approve anything; CASHIER on the money it records,
 * inside the same band as a driver; FINANCE on documents. The decisions follow
 * the ADR-0009 chain (migration 0037): work orders go to the branch's
 * Administrateur, entries to Finance up to the top recording band, and
 * anything above it to Direction.
 */
function defaultApprovalRules(): ApprovalRuleDefault[] {
  const DIRECTOR_ADMIN = ["DIRECTOR", "ADMIN"] as const;
  return [
    ...wildcard(
      [
        "register-asset",
        "commission-asset",
        "update-asset-details",
        "release-asset-to-service",
        "register-person",
        "reopen-activity",
        "assign-asset",
      ],
      DIRECTOR_ADMIN,
    ),
    // A transfer between branches is the decision of finance or Direction:
    // the more specific rule outranks the wildcard ones above.
    {
      ...wildcard(["assign-asset"], ["FINANCE"])[0]!,
      categoryCode: "CROSS_BRANCH",
    },
    {
      ...wildcard(["assign-asset"], ["DIRECTOR"])[0]!,
      categoryCode: "CROSS_BRANCH",
    },

    // Settings belong to Direction (ADR-0009). Modules are vendor-only
    // (ADR-0005); DIRECTOR holds the toggles until they move to platform scope.
    ...wildcard(
      [
        "enable-module",
        "disable-module",
        "update-approval-threshold",
        "set-template-preset",
        "create-category",
        "relabel-category",
        "deactivate-category",
        "reactivate-category",
        "create-branch",
        "rename-branch",
        "set-branch-status",
      ],
      ["DIRECTOR"],
    ),

    ...wildcard(["add-or-renew-document"], ["DIRECTOR", "ADMIN", "FINANCE"]),

    // App access. The handlers narrow ADMIN to the field roles in its branches.
    ...wildcard(
      ["add-member", "update-member-role", "deactivate-member", "reactivate-member", "reset-member-pin"],
      DIRECTOR_ADMIN,
    ),

    // Money in: the field and counter roles record inside the band, the roles
    // that keep the books at any amount.
    ...banded(["record-expense"], ["DRIVER", "ADMIN", "FINANCE", "DIRECTOR", "TECHNICIAN", "CASHIER"], RECORDING_BAND),
    ...banded(["record-revenue"], ["ADMIN", "FINANCE", "DIRECTOR", "CASHIER"], RECORDING_BAND),
    ...wildcard(["record-expense", "record-revenue"], ["FINANCE", "ADMIN", "DIRECTOR"]),

    // Finance decides an entry up to the top recording band, Direction at any
    // amount. DIRECTOR holds the band too: wherever the band matches it is the
    // more specific rule, and only the roles on it decide.
    // update-approval-threshold moves this band with the recording bands.
    ...banded(["approve-entry", "reject-entry"], ["FINANCE", "DIRECTOR"], RECORDING_BAND),
    ...wildcard(["approve-entry", "reject-entry"], ["DIRECTOR"]),
    ...wildcard(["reverse-entry", "lock-period"], ["FINANCE", "DIRECTOR"]),
    ...wildcard(["reopen-period"], ["DIRECTOR"]),

    ...wildcard(
      [
        "create-activity",
        "record-movement-leg",
        "record-meter-reading",
        "substitute-asset",
        "close-activity",
        "record-journey-sheet",
        "record-haulage-job-sheet",
      ],
      ["DIRECTOR", "ADMIN", "DRIVER"],
    ),
    // The workshop reads the odometer when a truck comes in.
    ...wildcard(["record-meter-reading"], ["TECHNICIAN"]),

    ...wildcard(["report-issue"], ["DIRECTOR", "ADMIN", "TECHNICIAN", "DRIVER"]),
    ...wildcard(
      ["resolve-issue", "dismiss-issue", "create-work-order", "complete-work-order", "cancel-work-order"],
      ["DIRECTOR", "ADMIN", "TECHNICIAN"],
    ),
    // Work orders are approved by the branch's Administrateur (ADR-0009). No
    // amount bounds, so a workspace that never sets a threshold never meets a
    // pending work order.
    ...wildcard(
      ["approve-work-order", "reject-work-order", "approve-work-order-closure", "reject-work-order-completion"],
      DIRECTOR_ADMIN,
    ),

    // A receipt, the author's edit of a pending entry, and a note change no
    // posted amount, so there is no band: whoever could record may do them.
    ...wildcard(
      ["attach-evidence", "update-pending-entry", "add-note"],
      ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"],
    ),
  ];
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
