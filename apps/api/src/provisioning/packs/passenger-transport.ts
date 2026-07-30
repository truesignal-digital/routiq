import type { categories } from "../../db/schema.js";

export const passengerTransportPack: {
  code: "PASSENGER_TRANSPORT";
  version: 1;
  categories: Array<Omit<typeof categories.$inferInsert, "workspaceId">>;
} = {
  code: "PASSENGER_TRANSPORT",
  version: 1,
  categories: [
    {
      kind: "ASSET_CLASS",
      code: "BUS",
      active: true,
      labelFr: "Bus",
      labelEn: "Bus",
    },
    {
      kind: "ASSET_CLASS",
      code: "VAN",
      active: true,
      labelFr: "Fourgonnette",
      labelEn: "Van",
    },
    {
      kind: "REVENUE_CATEGORY",
      code: "TICKET_REVENUE",
      active: true,
      labelFr: "Recettes de billetterie",
      labelEn: "Ticket revenue",
      profitabilityLayer: "DIRECT",
      evidencePolicy: "RECEIPT_EXPECTED",
    },
    {
      kind: "ACTIVITY_TYPE",
      code: "SCHEDULED_JOURNEY",
      active: true,
      labelFr: "Départ programmé",
      labelEn: "Scheduled journey",
    },
    {
      kind: "ACTIVITY_TYPE",
      code: "CHARTER",
      active: true,
      labelFr: "Affrètement",
      labelEn: "Charter",
    },
    {
      kind: "EXPENSE_CATEGORY",
      code: "CREW_ALLOWANCE",
      active: true,
      labelFr: "Indemnité équipage",
      labelEn: "Crew allowance",
      profitabilityLayer: "DIRECT",
      evidencePolicy: "NO_RECEIPT_EXPECTED",
    },
  ],
};
