import { CommandError } from "./dispatcher.js";

interface TemplateField {
  key: string;
  type: "string" | "number" | "boolean";
  required?: boolean;
}

interface TemplateDefinition {
  version: number;
  fields: TemplateField[];
}

const TEMPLATES: Record<string, TemplateDefinition> = {
  TRUCKING: {
    version: 1,
    fields: [
      { key: "axleCount", type: "number" },
      { key: "bodyType", type: "string" },
      { key: "tonnageCapacity", type: "number" },
    ],
  },
  PASSENGER_TRANSPORT: {
    version: 1,
    fields: [
      { key: "seatCount", type: "number", required: true },
      { key: "lineType", type: "string" },
    ],
  },
};

const GLOBAL_KEYS = new Set(["capacityValue", "capacityUnit"]);

export function validateCustomValues(
  templateCode: string,
  values: Record<string, unknown>,
): { version: number } {
  const template = TEMPLATES[templateCode];
  if (!template) {
    throw new CommandError(400, "VALIDATION_FAILED", { templateCode });
  }

  const fieldsByKey = new Map(template.fields.map((f) => [f.key, f]));
  const unknownKeys: string[] = [];
  const wrongType: Array<{ key: string; expected: string; got: string }> = [];
  const missingRequired: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    if (GLOBAL_KEYS.has(key)) continue;

    const field = fieldsByKey.get(key);
    if (!field) {
      unknownKeys.push(key);
      continue;
    }

    const actualType = typeof value;
    if (actualType !== field.type) {
      wrongType.push({ key, expected: field.type, got: actualType });
    }
  }

  for (const field of template.fields) {
    if (
      field.required &&
      (values[field.key] === undefined || values[field.key] === null)
    ) {
      missingRequired.push(field.key);
    }
  }

  if (unknownKeys.length > 0 || wrongType.length > 0 || missingRequired.length > 0) {
    throw new CommandError(400, "TEMPLATE_FIELD_INVALID", {
      unknownKeys: unknownKeys.length > 0 ? unknownKeys : undefined,
      wrongType: wrongType.length > 0 ? wrongType : undefined,
      missingRequired: missingRequired.length > 0 ? missingRequired : undefined,
    });
  }

  return { version: template.version };
}
