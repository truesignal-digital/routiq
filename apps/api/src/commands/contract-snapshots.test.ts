import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import "../server.js";
import { listCommandDefinitions } from "./dispatcher.js";

/**
 * A shipped command version never changes shape (#20): offline clients and
 * the receipt log replay payloads written against it. Each registered
 * name.vN has its input JSON Schema recorded under contract-snapshots/. A
 * change to that file is a breaking change — ship name.v(N+1) with a
 * compatibility handler for vN instead, as provision-workspace did. Never run
 * `vitest -u` to make this pass for an existing version; a new version gets
 * its snapshot written on first run.
 */
const SNAPSHOT_DIR = fileURLToPath(new URL("./contract-snapshots/", import.meta.url));
const definitions = listCommandDefinitions();

describe("command contract snapshots", () => {
  it.each(definitions.map((def) => [`${def.name}.v${def.version}`, def] as const))("%s keeps its shipped shape", async (key, def) => {
    const schema = z.toJSONSchema(def.payloadSchema, { io: "input", unrepresentable: "any" });
    await expect(`${JSON.stringify(schema, null, 2)}\n`).toMatchFileSnapshot(`./contract-snapshots/${key}.json`);
  });

  it("keeps a registered handler for every version that ever shipped", () => {
    const registered = new Set(definitions.map((def) => `${def.name}.v${def.version}.json`));
    const orphaned = readdirSync(SNAPSHOT_DIR).filter((file) => file.endsWith(".json") && !registered.has(file));
    expect(orphaned, "a shipped version lost its handler; queued and replayed payloads would be refused").toEqual([]);
  });
});
