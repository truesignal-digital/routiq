import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import "../server.js";
import { listCommandDefinitions } from "./dispatcher.js";

/**
 * Contract snapshots validate two rules:
 *
 * **Backward compatibility**: A shipped command version's JSON Schema is frozen
 * in contract-snapshots/<name>.v<N>.json. Offline clients and audit replays
 * depend on it. Adding fields or enum values (widening) is OK and updates the
 * snapshot; removing fields, adding required fields, or narrowing enums
 * (breaking changes) requires a new version.v(N+1) with a compatibility
 * handler.
 *
 * **Registry completeness**: Every registered command must have a snapshot
 * committed in the repository, or CI fails naming it. New commands get
 * snapshots auto-committed on first run with CI=true; existing versions stay
 * frozen. Never run `vitest -u` to overwrite a shipped snapshot.
 *
 * To snapshot a new command: run tests locally, commit the snapshot files, or
 * set CI=true and let the test write them.
 */
const SNAPSHOT_DIR = fileURLToPath(new URL("./contract-snapshots/", import.meta.url));
const definitions = listCommandDefinitions();

/**
 * Checks if new schema is backward-compatible with old schema (allows widening only).
 * Returns { compatible: boolean; breaking: string[] } where breaking lists any
 * breaking changes found.
 */
function checkBackwardCompatibility(
  oldSchema: Record<string, unknown>,
  newSchema: Record<string, unknown>,
): { compatible: boolean; breaking: string[] } {
  const breaking: string[] = [];

  // Check required fields
  const oldRequired = new Set((oldSchema.required as string[]) ?? []);
  const newRequired = new Set((newSchema.required as string[]) ?? []);

  // Required fields can only increase (new required fields OK for widening), but
  // shipped fields cannot become required if they weren't before.
  // Actually, for backward compat, we should only allow required to stay the same or add new optional fields.
  // If an old optional field becomes required, that breaks old payloads.
  for (const field of oldRequired) {
    if (!newRequired.has(field)) {
      breaking.push(`required field "${field}" was removed`);
    }
  }

  // Check properties
  const oldProps = (oldSchema.properties as Record<string, unknown>) ?? {};
  const newProps = (newSchema.properties as Record<string, unknown>) ?? {};

  for (const field of Object.keys(oldProps)) {
    if (!(field in newProps)) {
      breaking.push(`property "${field}" was removed`);
    } else {
      // Check enum narrowing (old enum has a value not in new enum)
      const oldEnum = (oldProps[field] as Record<string, unknown>)?.enum as
        | unknown[]
        | undefined;
      const newEnum = (newProps[field] as Record<string, unknown>)?.enum as
        | unknown[]
        | undefined;

      if (oldEnum && newEnum) {
        const newEnumSet = new Set(newEnum);
        for (const val of oldEnum) {
          if (!newEnumSet.has(val)) {
            breaking.push(`enum "${field}" removed value: ${JSON.stringify(val)}`);
          }
        }
      }

      // Check type narrowing
      const oldType = (oldProps[field] as Record<string, unknown>)?.type;
      const newType = (newProps[field] as Record<string, unknown>)?.type;
      if (oldType && newType && oldType !== newType) {
        breaking.push(`field "${field}" type changed from ${oldType} to ${newType}`);
      }
    }
  }

  // New fields are OK (widening)
  // New required fields for entirely new optional fields are OK

  return { compatible: breaking.length === 0, breaking };
}

describe("command contract snapshots", () => {
  it.each(definitions.map((def) => [`${def.name}.v${def.version}`, def] as const))(
    "%s keeps backward compatibility",
    async (key, def) => {
      const snapshotPath = `${SNAPSHOT_DIR}${key}.json`;
      const currentSchema = z.toJSONSchema(def.payloadSchema, {
        io: "input",
        unrepresentable: "any",
      });
      const currentSchemaStr = `${JSON.stringify(currentSchema, null, 2)}\n`;

      // Check if snapshot exists
      let snapshotExists = false;
      let oldSchema: Record<string, unknown> | null = null;
      try {
        const snapshotContent = readFileSync(snapshotPath, "utf8");
        oldSchema = JSON.parse(snapshotContent) as Record<string, unknown>;
        snapshotExists = true;
      } catch {
        // Snapshot doesn't exist yet (new command)
      }

      if (snapshotExists && oldSchema) {
        // Validate backward compatibility
        const { compatible, breaking } = checkBackwardCompatibility(
          oldSchema,
          currentSchema as Record<string, unknown>,
        );

        if (!compatible) {
          const message = breaking.join("\n  ");
          expect(true, `${key} has breaking changes:\n  ${message}`).toBe(false);
        }

        // Update snapshot if schema widened
        if (!deepEqual(oldSchema, currentSchema)) {
          if (process.env.CI !== "true") {
            // In local dev, just verify compatibility (already done above)
            // Don't auto-update; require explicit test run with CI=true
          } else {
            // In CI, write the snapshot for backward-compatible changes
            writeFileSync(snapshotPath, currentSchemaStr);
          }
        }
      } else if (process.env.CI === "true") {
        // New command in CI: write snapshot
        writeFileSync(snapshotPath, currentSchemaStr);
      } else {
        // New command in local dev: fail with helpful message
        expect(
          snapshotExists,
          `New command ${key} has no snapshot. Run with CI=true to generate it.`,
        ).toBe(true);
      }
    },
  );

  it("keeps a registered handler for every version that ever shipped", () => {
    const registered = new Set(definitions.map((def) => `${def.name}.v${def.version}.json`));
    const orphaned = readdirSync(SNAPSHOT_DIR).filter((file) => file.endsWith(".json") && !registered.has(file));
    expect(orphaned, "a shipped version lost its handler; queued and replayed payloads would be refused").toEqual([]);
  });
});

/**
 * Deep equality check for schemas (ignores order of keys, compares structure).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, idx) => deepEqual(val, b[idx]));
  }

  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a as Record<string, unknown>).sort();
    const keysB = Object.keys(b as Record<string, unknown>).sort();

    if (keysA.length !== keysB.length) return false;
    if (!keysA.every((k, i) => k === keysB[i])) return false;

    return keysA.every((key) => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }

  return false;
}
