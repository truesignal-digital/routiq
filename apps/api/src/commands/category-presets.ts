import type { categories } from "../db/schema.js";
import { corePack } from "../provisioning/packs/core.js";
import { passengerTransportPack } from "../provisioning/packs/passenger-transport.js";
import { truckingPack } from "../provisioning/packs/trucking.js";

export function presetCategories(
  workspaceId: string,
): Array<typeof categories.$inferInsert> {
  return [
    ...corePack.categories,
    ...truckingPack.categories,
    ...passengerTransportPack.categories,
  ].map((category) => ({ ...category, workspaceId }));
}
