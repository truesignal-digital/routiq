import { z } from "zod";

export const commissionAssetPayload = z.object({
  assetId: z.uuid(),
  commissionedAt: z.iso.datetime({ offset: true }).optional(),
});
export type CommissionAssetPayload = z.infer<typeof commissionAssetPayload>;

export const assignAssetPayload = z.object({
  assetId: z.uuid(),
  branchCode: z.string().min(1).optional(),
  /** A member to hand the vehicle to, or `null` to clear the custodian. */
  custodianMembershipId: z.uuid().nullable().optional(),
}).refine((p) => p.branchCode !== undefined || p.custodianMembershipId !== undefined, {
  message: "assign_target_required",
});
export type AssignAssetPayload = z.infer<typeof assignAssetPayload>;
