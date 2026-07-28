import { CommandError } from "./dispatcher.js";

interface TemplateField {
  key: string;
  type: "string" | "number" | "boolean";
  required?: boolean;
}

/**
 * §3.3 puts `custom_values` on assets, activities AND legs, so the field list is
 * keyed by entity as well as template. Without the entity dimension a haulage
 * sheet's cargo fields would be checked against a truck's axle count and
 * rejected as unknown.
 */
export type TemplateEntity = "asset" | "activity" | "leg";

interface TemplateDefinition {
  version: number;
  entities: Record<TemplateEntity, TemplateField[]>;
}

const TEMPLATES: Record<string, TemplateDefinition> = {
  TRUCKING: {
    version: 1,
    entities: {
      asset: [
        { key: "axleCount", type: "number" },
        { key: "bodyType", type: "string" },
        { key: "tonnageCapacity", type: "number" },
      ],
      activity: [
        { key: "cargoDescription", type: "string" },
        { key: "cargoWeightKg", type: "number" },
      ],
      leg: [],
    },
  },
  PASSENGER_TRANSPORT: {
    version: 1,
    entities: {
      asset: [
        { key: "seatCount", type: "number", required: true },
        { key: "lineType", type: "string" },
      ],
      activity: [
        { key: "seatsSold", type: "number" },
        { key: "seatsAvailable", type: "number" },
      ],
      leg: [],
    },
  },
};

const GLOBAL_KEYS = new Set(["capacityValue", "capacityUnit"]);

export function validateCustomValues(
  templateCode: string,
  values: Record<string, unknown>,
  entity: TemplateEntity = "asset",
): { version: number } {
  const template = TEMPLATES[templateCode];
  if (!template) {
    throw new CommandError(400, "VALIDATION_FAILED", { templateCode });
  }

  const fields = template.entities[entity];
  const fieldsByKey = new Map(fields.map((f) => [f.key, f]));
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

  for (const field of fields) {
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
