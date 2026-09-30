import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { listCommandDefinitions } from "./dispatcher.js";

/**
 * Shipped command contracts (#20). Each registered name.vN has its payload's
 * input JSON Schema stored in contract-snapshots/<name>.v<N>.json. The files
 * are only ever written by `pnpm --filter @routiq/api contracts:snapshot`
 * (scripts/contract-snapshots.ts), never by hand and never by a test.
 */
export const SNAPSHOT_DIR = fileURLToPath(new URL("./contract-snapshots/", import.meta.url));
export const SNAPSHOT_SCRIPT = "pnpm --filter @routiq/api contracts:snapshot";

type CommandDefinition = ReturnType<typeof listCommandDefinitions>[number];
export type JsonSchema = { [keyword: string]: unknown };

export function snapshotFile(def: Pick<CommandDefinition, "name" | "version">): string {
  return `${def.name}.v${def.version}.json`;
}

export function renderSnapshot(def: Pick<CommandDefinition, "payloadSchema">): string {
  const schema = z.toJSONSchema(def.payloadSchema, { io: "input", unrepresentable: "any" });
  return `${JSON.stringify(schema, null, 2)}\n`;
}

const ANNOTATIONS = new Set(["$schema", "title", "description", "default"]);
const HANDLED = new Set([
  ...ANNOTATIONS,
  "type",
  "enum",
  "const",
  "anyOf",
  "oneOf",
  "properties",
  "required",
  "additionalProperties",
  "propertyNames",
  "items",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
]);

/**
 * Lists every way `current` rejects a payload that `shipped` accepted. An empty
 * list means every payload valid under the shipped contract stays valid, so
 * widening (a new optional field, an added enum value, a newly nullable field,
 * a looser bound) passes and narrowing does not. A removed field counts as
 * narrowing even on an open object: the payload still parses, but the value it
 * carried is silently dropped.
 */
export function contractBreaks(shipped: JsonSchema, current: JsonSchema): string[] {
  return compare(shipped, current, "");
}

function compare(old: JsonSchema, cur: JsonSchema, path: string): string[] {
  const oldBranches = branches(old);
  if (oldBranches) {
    const curOptions = branches(cur) ?? [cur];
    return oldBranches.flatMap((branch) => {
      const dropped = droppedVariant(branch, curOptions);
      return dropped ? [`${label(path)} dropped its ${dropped} variant`] : compare(branch, cur, path);
    });
  }

  const curBranches = branches(cur);
  if (curBranches) {
    let best: string[] | undefined;
    for (const branch of curBranches) {
      const issues = compare(old, branch, path);
      if (issues.length === 0) return [];
      if (!best || issues.length < best.length) best = issues;
    }
    return best ?? [`${label(path)} accepts nothing any more`];
  }

  if (Object.keys(cur).every((keyword) => ANNOTATIONS.has(keyword))) return [];

  const issues: string[] = [];
  const typeIssue = compareTypes(old, cur, path);
  if (typeIssue) return [typeIssue];

  issues.push(...compareValues(old, cur, path));
  issues.push(...compareObjects(old, cur, path));
  if (old.items !== undefined || cur.items !== undefined) {
    issues.push(...compare(asSchema(old.items), asSchema(cur.items), `${path}[]`));
  }
  issues.push(...compareBounds(old, cur, path));
  if (cur.pattern !== undefined && cur.pattern !== old.pattern) {
    issues.push(`${label(path)} must now match a different pattern`);
  }
  if (cur.format !== undefined && cur.format !== old.format) {
    issues.push(`${label(path)} changed format from ${String(old.format ?? "none")} to ${String(cur.format)}`);
  }

  for (const keyword of new Set([...Object.keys(old), ...Object.keys(cur)])) {
    if (!HANDLED.has(keyword) && JSON.stringify(old[keyword]) !== JSON.stringify(cur[keyword])) {
      issues.push(`${label(path)} changed its "${keyword}" rule, which this check cannot prove compatible`);
    }
  }
  return issues;
}

function branches(schema: JsonSchema): JsonSchema[] | undefined {
  const union = schema.anyOf ?? schema.oneOf;
  return Array.isArray(union) ? union.map(asSchema) : undefined;
}

/** Names the discriminator value of a shipped union branch that no current branch accepts. */
function droppedVariant(old: JsonSchema, curBranches: JsonSchema[]): string | undefined {
  const props = (old.properties ?? {}) as Record<string, JsonSchema>;
  for (const [key, schema] of Object.entries(props)) {
    if (!("const" in schema)) continue;
    const value = JSON.stringify(schema.const);
    const kept = curBranches.some((branch) => {
      const values = allowedValues(asSchema((branch.properties as Record<string, unknown> | undefined)?.[key]));
      return !values || values.some((candidate) => JSON.stringify(candidate) === value);
    });
    if (!kept) return `${key}=${value}`;
  }
  return undefined;
}

function asSchema(value: unknown): JsonSchema {
  if (value === undefined || value === true) return {};
  if (value === false) return { not: {} };
  return value as JsonSchema;
}

function label(path: string): string {
  return path === "" ? "the payload" : `field "${path}"`;
}

function child(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

function typesOf(schema: JsonSchema): Set<string> | undefined {
  if (typeof schema.type === "string") return new Set([schema.type]);
  if (Array.isArray(schema.type)) return new Set(schema.type as string[]);
  const values = allowedValues(schema);
  if (values) return new Set(values.map(jsonType));
  return undefined;
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function compareTypes(old: JsonSchema, cur: JsonSchema, path: string): string | undefined {
  const curTypes = typesOf(cur);
  if (!curTypes) return undefined;
  const oldTypes = typesOf(old);
  if (!oldTypes) return `${label(path)} must now be ${[...curTypes].join(" or ")}`;
  const lost = [...oldTypes].filter((type) => !curTypes.has(type) && !(type === "integer" && curTypes.has("number")));
  if (lost.length === 0) return undefined;
  if (lost.length === 1 && lost[0] === "null") return `${label(path)} no longer accepts null`;
  return `${label(path)} changed type from ${[...oldTypes].join(" or ")} to ${[...curTypes].join(" or ")}`;
}

function allowedValues(schema: JsonSchema): unknown[] | undefined {
  if ("const" in schema) return [schema.const];
  if (Array.isArray(schema.enum)) return schema.enum;
  return undefined;
}

function compareValues(old: JsonSchema, cur: JsonSchema, path: string): string[] {
  const curValues = allowedValues(cur);
  if (!curValues) return [];
  const oldValues = allowedValues(old);
  if (!oldValues) return [`${label(path)} is now limited to ${curValues.map((value) => JSON.stringify(value)).join(", ")}`];
  const allowed = new Set(curValues.map((value) => JSON.stringify(value)));
  return oldValues
    .filter((value) => !allowed.has(JSON.stringify(value)))
    .map((value) => `${label(path)} no longer accepts the value ${JSON.stringify(value)}`);
}

function compareObjects(old: JsonSchema, cur: JsonSchema, path: string): string[] {
  const issues: string[] = [];
  const oldProps = (old.properties ?? {}) as Record<string, unknown>;
  const curProps = (cur.properties ?? {}) as Record<string, unknown>;
  const oldRequired = new Set((old.required ?? []) as string[]);

  for (const [key, schema] of Object.entries(oldProps)) {
    const field = child(path, key);
    if (!(key in curProps)) {
      issues.push(`${label(field)} was removed`);
      continue;
    }
    const oldDefault = JSON.stringify((schema as JsonSchema).default);
    const curDefault = JSON.stringify((curProps[key] as JsonSchema).default);
    if (oldDefault !== curDefault) {
      issues.push(`${label(field)} changed its default from ${oldDefault ?? "none"} to ${curDefault ?? "none"}`);
    }
    issues.push(...compare(asSchema(schema), asSchema(curProps[key]), field));
  }

  for (const key of (cur.required ?? []) as string[]) {
    if (oldRequired.has(key)) continue;
    const field = child(path, key);
    issues.push(key in oldProps ? `${label(field)} became required` : `new field "${field}" is required`);
  }

  if (cur.additionalProperties === false && old.additionalProperties !== false) {
    issues.push(`${label(path)} no longer accepts extra fields`);
  } else if (cur.additionalProperties !== undefined && old.additionalProperties !== false) {
    issues.push(...compare(asSchema(old.additionalProperties), asSchema(cur.additionalProperties), `${path}{*}`));
  }
  if (cur.propertyNames !== undefined) {
    issues.push(...compare(asSchema(old.propertyNames), asSchema(cur.propertyNames), `${path}{keys}`));
  }
  return issues;
}

type Bound = { value: number; exclusive: boolean };

function lowerBound(schema: JsonSchema): Bound | undefined {
  const inclusive = typeof schema.minimum === "number" ? schema.minimum : undefined;
  const exclusive = typeof schema.exclusiveMinimum === "number" ? schema.exclusiveMinimum : undefined;
  if (inclusive === undefined && exclusive === undefined) return undefined;
  if (exclusive !== undefined && (inclusive === undefined || exclusive >= inclusive)) return { value: exclusive, exclusive: true };
  return { value: inclusive as number, exclusive: false };
}

function upperBound(schema: JsonSchema): Bound | undefined {
  const inclusive = typeof schema.maximum === "number" ? schema.maximum : undefined;
  const exclusive = typeof schema.exclusiveMaximum === "number" ? schema.exclusiveMaximum : undefined;
  if (inclusive === undefined && exclusive === undefined) return undefined;
  if (exclusive !== undefined && (inclusive === undefined || exclusive <= inclusive)) return { value: exclusive, exclusive: true };
  return { value: inclusive as number, exclusive: false };
}

function describeBound(bound: Bound | undefined, side: "min" | "max"): string {
  if (!bound) return "none";
  const sign = side === "min" ? (bound.exclusive ? ">" : ">=") : bound.exclusive ? "<" : "<=";
  return `${sign} ${bound.value}`;
}

function compareBounds(old: JsonSchema, cur: JsonSchema, path: string): string[] {
  const issues: string[] = [];
  const oldMin = lowerBound(old);
  const curMin = lowerBound(cur);
  if (curMin && (!oldMin || curMin.value > oldMin.value || (curMin.value === oldMin.value && curMin.exclusive && !oldMin.exclusive))) {
    issues.push(`${label(path)} raised its minimum from ${describeBound(oldMin, "min")} to ${describeBound(curMin, "min")}`);
  }
  const oldMax = upperBound(old);
  const curMax = upperBound(cur);
  if (curMax && (!oldMax || curMax.value < oldMax.value || (curMax.value === oldMax.value && curMax.exclusive && !oldMax.exclusive))) {
    issues.push(`${label(path)} lowered its maximum from ${describeBound(oldMax, "max")} to ${describeBound(curMax, "max")}`);
  }
  for (const [minKey, maxKey, unit] of [
    ["minLength", "maxLength", "characters"],
    ["minItems", "maxItems", "items"],
  ] as const) {
    const oldLow = typeof old[minKey] === "number" ? old[minKey] : 0;
    const curLow = typeof cur[minKey] === "number" ? cur[minKey] : 0;
    if (curLow > oldLow) issues.push(`${label(path)} now needs at least ${curLow} ${unit} (was ${oldLow})`);
    const oldHigh = typeof old[maxKey] === "number" ? old[maxKey] : Number.POSITIVE_INFINITY;
    const curHigh = typeof cur[maxKey] === "number" ? cur[maxKey] : Number.POSITIVE_INFINITY;
    if (curHigh < oldHigh) {
      issues.push(`${label(path)} now allows at most ${curHigh} ${unit} (was ${Number.isFinite(oldHigh) ? oldHigh : "no limit"})`);
    }
  }
  return issues;
}
