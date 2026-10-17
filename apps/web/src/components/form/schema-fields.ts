import type { z } from "zod";

type Def = {
  type: string;
  shape?: Record<string, z.ZodType>;
  innerType?: z.ZodType;
  in?: z.ZodType;
  element?: z.ZodType;
};

const defOf = (schema: z.ZodType) => (schema as unknown as { _zod: { def: Def } })._zod.def;

/**
 * The part of a form's schema that validates one field, by its dotted name.
 * Pipes are read on their input side, which is what the field holds.
 */
export function fieldSchema(schema: z.ZodType, name: string): z.ZodType | undefined {
  let current: z.ZodType | undefined = schema;
  for (const key of name.split(".")) {
    current = objectOf(current)?.[key];
    if (current === undefined) return undefined;
  }
  return current;
}

function objectOf(schema: z.ZodType | undefined): Record<string, z.ZodType> | undefined {
  let current = schema;
  while (current !== undefined) {
    const def = defOf(current);
    if (def.shape !== undefined) return def.shape;
    current = def.type === "pipe" ? def.in : def.innerType;
  }
  return undefined;
}

/**
 * A field is required when its schema refuses it left empty: neither nothing
 * nor an empty string passes. The field kit marks it with the red asterisk, so
 * the marker always says what the contract enforces.
 */
export function isRequired(schema: z.ZodType, name: string): boolean {
  const field = fieldSchema(schema, name);
  if (field === undefined) return false;
  return !field.safeParse(undefined).success && !field.safeParse("").success && !field.safeParse([]).success;
}
