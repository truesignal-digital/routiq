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

export type TemplateFieldIssue =
  | { key: string; kind: "unknown" }
  | { key: string; kind: "wrongType"; expected: TemplateFieldDef["type"] }
  | { key: string; kind: "required" };

/**
 * Client-side mirror of the server's custom-values validation so forms can
 * show inline field errors before submitting. The server remains the
 * enforcement point (TEMPLATE_FIELD_INVALID).
 */
export function templateFieldIssues(
  templateCode: string,
  values: Record<string, unknown>,
): TemplateFieldIssue[] {
  const fields = TEMPLATE_FIELDS[templateCode as TemplateCode];
  if (!fields) return [];
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const issues: TemplateFieldIssue[] = [];

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    const field = byKey.get(key);
    if (!field) {
      issues.push({ key, kind: "unknown" });
    } else if (typeof value !== field.type) {
      issues.push({ key, kind: "wrongType", expected: field.type });
    }
  }
  for (const field of fields) {
    if (field.required === true && (values[field.key] === undefined || values[field.key] === null)) {
      issues.push({ key: field.key, kind: "required" });
    }
  }
  return issues;
}
