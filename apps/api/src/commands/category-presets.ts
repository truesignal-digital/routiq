import type { categories } from "../db/schema.js";

export function presetCategories(
  workspaceId: string,
): Array<typeof categories.$inferInsert> {
  return [
    {
      workspaceId,
      kind: "ASSET_CLASS",
      code: "TRUCK",
      active: true,
      labelFr: "Camion",
      labelEn: "Truck",
    },
    {
      workspaceId,
      kind: "ASSET_CLASS",
      code: "TRAILER",
      active: true,
      labelFr: "Remorque",
      labelEn: "Trailer",
    },
    {
      workspaceId,
      kind: "ASSET_CLASS",
      code: "BUS",
      active: true,
      labelFr: "Bus",
      labelEn: "Bus",
    },
    {
      workspaceId,
      kind: "ASSET_CLASS",
      code: "VAN",
      active: true,
      labelFr: "Fourgonnette",
      labelEn: "Van",
    },
    {
      workspaceId,
      kind: "DOCUMENT_TYPE",
      code: "INSURANCE",
      active: true,
      labelFr: "Assurance",
      labelEn: "Insurance",
    },
    {
      workspaceId,
      kind: "DOCUMENT_TYPE",
      code: "PERMIT",
      active: true,
      labelFr: "Permis",
      labelEn: "Permit",
    },
  ];
}
