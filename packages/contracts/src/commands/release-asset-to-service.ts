import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * Remise en service. The server reads what grounded the asset — its open
 * availability interval and the signalement that opened it — and requires a
 * COMPLETED work order answering THAT signalement. `workOrderId` is optional:
 * when given it must be such an order; when omitted any completed one counts.
 *
 * `overrideReason` is the release without a completed work order, and is only
 * accepted once the grounding signalement has itself been closed (resolved on
 * the spot or dismissed as reported in error) — the human assertion that the
 * problem is gone then comes from that decision, and this reason says why no
 * work order was needed.
 *
 * Either way, every other safety-critical signalement on the asset has to be
 * closed first (409 SAFETY_ISSUE_OPEN). A release on a completed work order
 * while the grounding signalement itself stays OPEN succeeds with the warning
 * GROUNDING_ISSUE_STILL_OPEN.
 */
export const releaseAssetToServicePayload = z.object({
  assetId: z.uuid(),
  workOrderId: z.uuid().optional(),
  overrideReason: z.string().trim().min(1).max(500).optional(),
  note: z.string().min(1).max(500).optional(),
});

export const releaseAssetToServiceCommand = z.object({
  name: z.literal("release-asset-to-service"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: releaseAssetToServicePayload,
});

export type ReleaseAssetToServiceCommand = z.infer<typeof releaseAssetToServiceCommand>;
