/**
 * The entry fields the API added for the vehicle workspace (#44) and the
 * finance links (#87), at their "nothing known" values — for finance fixtures
 * that predate them.
 */
export const entryVehicleFields = {
  recordedBy: { principalId: null, displayName: null, scope: "WORKSPACE" as const },
  evidence: { state: "NOT_SUPPLIED" as const, artifactCount: 0 },
  assetShareMinor: null,
  assetLinks: null,
  links: { activityId: null, activityNumber: null, workOrderId: null, workOrderAssetId: null },
};
