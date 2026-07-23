/**
 * Per-template custom-field lists (§3.3: template variance is data, the
 * field list per template lives in code). Mirrors the server's validator
 * (apps/api/src/commands/templates.ts) so clients can render the right
 * fields; the server remains the enforcement point. Backend: adopt this
 * module as the single source to eliminate the mirror.
 */
export interface TemplateFieldDef {
  key: string;
  type: "string" | "number" | "boolean";
  required?: boolean;
}

export const TEMPLATE_CODES = ["TRUCKING", "PASSENGER_TRANSPORT"] as const;
export type TemplateCode = (typeof TEMPLATE_CODES)[number];

export const TEMPLATE_FIELDS: Record<TemplateCode, TemplateFieldDef[]> = {
  TRUCKING: [
    { key: "axleCount", type: "number" },
    { key: "bodyType", type: "string" },
    { key: "tonnageCapacity", type: "number" },
  ],
  PASSENGER_TRANSPORT: [
    { key: "seatCount", type: "number", required: true },
    { key: "lineType", type: "string" },
  ],
};
