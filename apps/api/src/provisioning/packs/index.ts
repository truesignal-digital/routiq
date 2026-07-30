import type { TemplateCode } from "@routiq/contracts";
import type { approvalRules, categories } from "../../db/schema.js";
import { passengerTransportPack } from "./passenger-transport.js";
import { truckingPack } from "./trucking.js";

/**
 * What provisioning replays into a new workspace. Approval rules are optional
 * because only the core pack ships them today — but a preset pack that grew its
 * own rules must be replayed, not silently ignored, so the field is part of the
 * contract rather than something the replay code reaches for by name.
 */
export interface StarterPack {
  code: string;
  version: number;
  categories: Array<Omit<typeof categories.$inferInsert, "workspaceId">>;
  approvalRules?: Array<Omit<typeof approvalRules.$inferInsert, "workspaceId">>;
}

/**
 * One starter pack per template preset. Typed as a total map over TEMPLATE_CODES
 * so a new preset without a pack fails to compile rather than provisioning a
 * workspace with no categories for it.
 */
export const PRESET_PACKS: Record<TemplateCode, StarterPack> = {
  TRUCKING: truckingPack,
  PASSENGER_TRANSPORT: passengerTransportPack,
};
