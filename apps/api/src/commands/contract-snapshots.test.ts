import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import "../server.js";
import { contractBreaks, renderSnapshot, SNAPSHOT_DIR, SNAPSHOT_SCRIPT, snapshotFile, type JsonSchema } from "./contract-snapshots.js";
import { listCommandDefinitions } from "./dispatcher.js";

/**
 * A shipped command version keeps accepting every payload it ever accepted
 * (#20): offline clients and the receipt log replay payloads written against
 * it. Each registered name.vN has its input JSON Schema stored in
 * contract-snapshots/<name>.v<N>.json, and the current schema must accept
 * everything the stored one does.
 *
 * - Widening (new optional field, added enum value, newly nullable, looser
 *   bound) passes. The test prints a reminder; refresh the stored file with
 *   `pnpm --filter @routiq/api contracts:snapshot` and commit it.
 * - Narrowing (removed field, newly required field, removed enum value, type
 *   change, tighter bound) fails. Ship name.v(N+1) with a compatibility
 *   handler for vN instead, as provision-workspace did.
 * - A registered version with no snapshot fails, locally and in CI. Run the
 *   script and commit the new file.
 * - A snapshot with no registered handler fails.
 *
 * Tests never write snapshots. Only the script does, and it refuses to rewrite
 * a narrowed one.
 */
const definitions = listCommandDefinitions();

describe("command contract snapshots", () => {
  it.each(definitions.map((def) => [snapshotFile(def), def] as const))("%s accepts every payload it shipped with", (file, def) => {
    const path = `${SNAPSHOT_DIR}${file}`;
    expect(existsSync(path), `${file} has no stored contract. Run \`${SNAPSHOT_SCRIPT}\` and commit the new file.`).toBe(true);

    const stored = readFileSync(path, "utf8");
    const rendered = renderSnapshot(def);
    if (stored === rendered) return;

    const breaks = contractBreaks(JSON.parse(stored) as JsonSchema, JSON.parse(rendered) as JsonSchema);
    expect(
      breaks,
      `${def.name}.v${def.version} no longer accepts payloads it shipped with. Keep v${def.version} as it was and add ${def.name}.v${def.version + 1} with a compatibility handler for v${def.version}`,
    ).toEqual([]);
    console.warn(`${file} widened compatibly. Run \`${SNAPSHOT_SCRIPT}\` and commit the refreshed snapshot.`);
  });

  it("keeps a registered handler for every version that ever shipped", () => {
    const registered = new Set(definitions.map(snapshotFile));
    const orphaned = readdirSync(SNAPSHOT_DIR).filter((file) => file.endsWith(".json") && !registered.has(file));
    expect(orphaned, "a shipped version lost its handler; queued and replayed payloads would be refused").toEqual([]);
  });
});

describe("contractBreaks", () => {
  const uuid = z.uuid();
  const base = z.object({
    id: uuid,
    role: z.enum(["ADMIN", "DRIVER"]),
    note: z.string().max(500).optional(),
    count: z.number().int().min(0),
  });
  const breaksBetween = (shipped: z.ZodType, current: z.ZodType) =>
    contractBreaks(JSON.parse(renderSnapshot({ payloadSchema: shipped })) as JsonSchema, JSON.parse(renderSnapshot({ payloadSchema: current })) as JsonSchema);

  it.each([
    ["an identical schema", base],
    ["a new optional field", base.extend({ odometerKm: z.number().optional() })],
    ["an added enum value", base.extend({ role: z.enum(["ADMIN", "DRIVER", "MECHANIC"]) })],
    ["a field that became nullable", base.extend({ note: z.string().max(500).nullable().optional() })],
    ["a required field that became optional", base.extend({ count: z.number().int().min(0).optional() })],
    ["a looser bound", base.extend({ note: z.string().max(1000).optional() })],
  ])("accepts %s", (_, current) => {
    expect(breaksBetween(base, current)).toEqual([]);
  });

  it.each([
    ["a removed field", base.omit({ note: true }), ['field "note" was removed'], base],
    ["an optional field that became required", base.extend({ note: z.string().max(500) }), ['field "note" became required'], base],
    ["a new required field", base.extend({ branchId: uuid }), ['new field "branchId" is required'], base],
    ["a removed enum value", base.extend({ role: z.enum(["ADMIN"]) }), ['field "role" no longer accepts the value "DRIVER"'], base],
    ["a type change", base.extend({ count: z.string() }), ['field "count" changed type from integer to string'], base],
    ["a dropped null", z.object({ note: z.string() }), ['field "note" no longer accepts null'], z.object({ note: z.string().nullable() })],
    ["a tighter bound", base.extend({ note: z.string().max(100).optional() }), ['field "note" now allows at most 100 characters (was 500)'], base],
    ["a strict object", z.strictObject(base.shape), ["the payload no longer accepts extra fields"], base],
  ] as const)("refuses %s", (_, current, expected, shipped) => {
    expect(breaksBetween(shipped, current)).toEqual(expected);
  });

  it("follows nested objects and array items", () => {
    const shipped = z.object({ legs: z.array(z.object({ km: z.number(), stop: z.string().optional() })) });
    const current = z.object({ legs: z.array(z.object({ km: z.number(), stop: z.string() })) });
    expect(breaksBetween(shipped, current)).toEqual(['field "legs[].stop" became required']);
  });

  it("matches each shipped union branch against the current branches", () => {
    const place = z.object({ kind: z.literal("place"), placeId: uuid });
    const text = z.object({ kind: z.literal("text"), text: z.string() });
    const gps = z.object({ kind: z.literal("gps"), lat: z.number() });
    expect(breaksBetween(z.object({ origin: z.discriminatedUnion("kind", [place, text]) }), z.object({ origin: z.discriminatedUnion("kind", [place, text, gps]) }))).toEqual([]);
    expect(breaksBetween(z.object({ origin: z.discriminatedUnion("kind", [place, text]) }), z.object({ origin: z.discriminatedUnion("kind", [place]) }))).toEqual([
      'field "origin" dropped its kind="text" variant',
    ]);
  });
});
