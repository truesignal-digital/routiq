import type { categories } from "../../db/schema.js";

export const truckingPack: {
  code: "TRUCKING";
  version: 1;
  categories: Array<Omit<typeof categories.$inferInsert, "workspaceId">>;
} = {
  code: "TRUCKING",
  version: 1,
  categories: [
    {
      kind: "ASSET_CLASS",
      code: "TRUCK",
      active: true,
      labelFr: "Camion",
      labelEn: "Truck",
    },
    {
      kind: "ASSET_CLASS",
      code: "TRAILER",
      active: true,
      labelFr: "Remorque",
      labelEn: "Trailer",
    },
    {
      kind: "REVENUE_CATEGORY",
      code: "FREIGHT_REVENUE",
      active: true,
      labelFr: "Recettes de fret",
      labelEn: "Freight revenue",
      profitabilityLayer: "DIRECT",
      evidencePolicy: "RECEIPT_EXPECTED",
    },
    {
      kind: "ACTIVITY_TYPE",
      code: "HAULAGE_JOB",
      active: true,
      labelFr: "Job de halage",
      labelEn: "Haulage job",
    },
    {
      kind: "EXPENSE_CATEGORY",
      code: "LOADING",
      active: true,
      labelFr: "Chargement",
      labelEn: "Loading",
      profitabilityLayer: "DIRECT",
      evidencePolicy: "NO_RECEIPT_EXPECTED",
    },
  ],
};
