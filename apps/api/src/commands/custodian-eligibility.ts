/**
 * Who may hold a vehicle: an active member whose branches cover the vehicle's
 * branch. `assign-asset` refuses anyone else with CUSTODIAN_INELIGIBLE, and the
 * candidates read lists exactly the members this accepts, so the picker can
 * never offer a choice the command will refuse.
 */
export type CustodianIneligibility = "DEACTIVATED" | "OUT_OF_SCOPE";

export interface CustodianMembership {
  deactivatedAt: Date | null;
  allBranches: boolean;
  branchIds: readonly string[];
}

export function custodianIneligibility(
  membership: CustodianMembership,
  branchId: string,
): CustodianIneligibility | undefined {
  if (membership.deactivatedAt !== null) return "DEACTIVATED";
  if (!membership.allBranches && !membership.branchIds.includes(branchId)) {
    return "OUT_OF_SCOPE";
  }
  return undefined;
}
