import { z } from "zod";

/**
 * A command runs in the workspace, as the actor and within the branch scope its
 * session proves (§5, envelope.ts). None of the three ever comes from the
 * request: a field that let the caller name them would let one tenant write
 * into another, or one member act as someone else.
 *
 * Two kinds of field are told apart here.
 *
 * - AUTHORITY fields name the caller's own context: `workspaceId`, `tenantId`,
 *   `actorId`, `authorizedBranchIds`. No command schema may accept one, no
 *   declaration can exempt one, and the dispatcher refuses a request carrying
 *   one anywhere in its envelope or payload rather than silently dropping it.
 * - TARGET fields are identity-shaped but name the record a command acts on:
 *   the branch being renamed, the member whose role changes, the workspace an
 *   operator provisions. They are legitimate only when declared with what they
 *   mean (`ScopeTargetDeclaration`), and the handler still resolves them inside
 *   the server-derived workspace, so a foreign id is simply not found.
 */

/** Keys compared lower-case with separators removed: `workspace_id` is `workspaceId`. */
function normalize(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const AUTHORITY_KEYS: readonly RegExp[] = [
  /^(workspace|tenant|organi[sz]ation|org|company)ids?$/,
  /^tenant(slug|code|key)?$/,
  /^actor/,
  /^(authori[sz]ed|authenticated|auth|caller|session|requester|requesting|current|my)(principal|user|member|membership|actor|workspace|tenant|role|branch|scope)/,
];

const TARGET_KEYS: readonly RegExp[] = [
  /(principal|membership|member|user)ids?$/,
  /^principaltype$/,
  /branch(id|ids|code|codes|scope)$/,
  /scopes?$/,
  /(workspace|tenant)(ids?|slug|code)?$/,
  /roles?$/,
];

/** True for a key that would name the caller's workspace, identity or authorized scope. */
export function isClientAuthorityKey(key: string): boolean {
  const normalized = normalize(key);
  return AUTHORITY_KEYS.some((pattern) => pattern.test(normalized));
}

/** True for an identity-shaped key that is legitimate only as a declared target reference. */
export function isScopeTargetKey(key: string): boolean {
  if (isClientAuthorityKey(key)) return false;
  const normalized = normalize(key);
  return TARGET_KEYS.some((pattern) => pattern.test(normalized));
}

/**
 * Every authority key in a raw request value, at any depth, as a path. Keys
 * only: a note that says "workspaceId" is text, not a field. Runs on the JSON
 * as it arrived, before any schema strips unknown keys.
 */
export function clientAuthorityKeyPaths(value: unknown): (string | number)[][] {
  const found: (string | number)[][] = [];
  const walk = (node: unknown, path: (string | number)[]): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, [...path, index]));
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (isClientAuthorityKey(key)) found.push([...path, key]);
      walk(child, [...path, key]);
    }
  };
  walk(value, []);
  return found;
}

export interface ScopeField {
  /** `crew[].role`, `users[].branchScope`; `{*}` marks a record's values. */
  path: string;
  kind: "authority" | "target";
}

type JsonSchema = { [keyword: string]: unknown };

/**
 * Every scope-shaped field a schema accepts as input: nested objects, array
 * items, union branches, record values and `$ref`s included. A record's KEYS
 * cannot be listed from its schema; `clientAuthorityKeyPaths` covers them at
 * the boundary.
 */
export function scopeFieldsOf(schema: z.ZodType): ScopeField[] {
  const root = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema;
  const defs = { ...asRecord(root.$defs), ...asRecord(root.definitions) };
  const found = new Map<string, ScopeField>();
  const seenRefs = new Set<string>();

  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== "object") return;
    const schemaNode = node as JsonSchema;

    if (typeof schemaNode.$ref === "string" && !seenRefs.has(schemaNode.$ref)) {
      seenRefs.add(schemaNode.$ref);
      const name = schemaNode.$ref.split("/").pop() ?? "";
      walk(defs[name], path);
    }
    for (const [key, child] of Object.entries(asRecord(schemaNode.properties))) {
      const childPath = path === "" ? key : `${path}.${key}`;
      if (isClientAuthorityKey(key)) found.set(childPath, { path: childPath, kind: "authority" });
      else if (isScopeTargetKey(key)) found.set(childPath, { path: childPath, kind: "target" });
      walk(child, childPath);
    }
    for (const keyword of ["anyOf", "oneOf", "allOf", "prefixItems"]) {
      const list = schemaNode[keyword];
      if (Array.isArray(list)) list.forEach((branch) => walk(branch, path));
    }
    for (const keyword of ["not", "if", "then", "else"]) walk(schemaNode[keyword], path);
    walk(schemaNode.items, `${path}[]`);
    walk(schemaNode.additionalProperties, `${path}{*}`);
    for (const child of Object.values(asRecord(schemaNode.patternProperties))) walk(child, `${path}{*}`);
  };

  walk(root, "");
  return [...found.values()];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * One legitimate target reference: the field path, the `name.vN` commands that
 * carry it, and what it points at. The meaning is for the reader; the check
 * holds the list exact in both directions.
 */
export interface ScopeTargetDeclaration {
  path: string;
  commands: readonly string[];
  meaning: string;
}

export interface RegisteredSchema {
  /** `name.vN` */
  command: string;
  schema: z.ZodType;
}

/**
 * Why a set of registered command schemas is unsafe, or `[]`. An authority
 * field fails whatever the declarations say; an undeclared target fails; a
 * declaration naming an authority field, or matching nothing, fails so the list
 * cannot drift into an allowance.
 */
export function commandScopeViolations(
  registered: readonly RegisteredSchema[],
  targets: readonly ScopeTargetDeclaration[],
): string[] {
  const violations: string[] = [];
  const declared = new Set(targets.flatMap((target) => target.commands.map((command) => `${command}:${target.path}`)));
  const used = new Set<string>();

  for (const declaration of targets) {
    const leaf = declaration.path.split(/[.[\]{}*]+/).filter(Boolean).pop() ?? "";
    if (isClientAuthorityKey(leaf)) {
      violations.push(`declaration "${declaration.path}" names caller authority, which no declaration can allow`);
    }
  }

  for (const { command, schema } of registered) {
    for (const field of scopeFieldsOf(schema)) {
      const key = `${command}:${field.path}`;
      if (field.kind === "authority") {
        violations.push(`${command} accepts "${field.path}", which names the caller's own workspace, identity or scope`);
      } else if (declared.has(key)) {
        used.add(key);
      } else {
        violations.push(`${command} accepts "${field.path}" with no target declaration saying what it points at`);
      }
    }
  }

  for (const key of declared) {
    if (!used.has(key)) violations.push(`target declaration "${key}" matches no registered field`);
  }
  return violations;
}
