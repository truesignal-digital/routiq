export const CATEGORY_KINDS = [
  "ASSET_CLASS",
  "ACTIVITY_TYPE",
  "REVENUE_CATEGORY",
  "EXPENSE_CATEGORY",
  "DOCUMENT_TYPE",
  "ISSUE_TYPE",
] as const;

export const PROFITABILITY_LAYERS = [
  "DIRECT",
  "MAINTENANCE",
  "OWNERSHIP",
  "SHARED",
] as const;

export const EVIDENCE_POLICIES = [
  "RECEIPT_EXPECTED",
  "NO_RECEIPT_EXPECTED",
] as const;

export type CategoryKind = (typeof CATEGORY_KINDS)[number];
export type ProfitabilityLayer = (typeof PROFITABILITY_LAYERS)[number];
export type EvidencePolicy = (typeof EVIDENCE_POLICIES)[number];
