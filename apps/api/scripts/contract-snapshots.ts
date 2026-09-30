/**
 * Writes apps/api/src/commands/contract-snapshots/<name>.v<N>.json for every
 * registered command version: `pnpm --filter @routiq/api contracts:snapshot`.
 *
 * New versions get a snapshot; widened ones are refreshed. A narrowed shipped
 * version is refused, because rewriting its snapshot would hide the break: add
 * name.v(N+1) with a compatibility handler instead. Orphaned snapshots are
 * reported and kept, since a shipped version must keep its handler.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import "../src/server.js";
import { contractBreaks, renderSnapshot, SNAPSHOT_DIR, snapshotFile, type JsonSchema } from "../src/commands/contract-snapshots.js";
import { listCommandDefinitions } from "../src/commands/dispatcher.js";

const definitions = listCommandDefinitions();
const counts = { created: 0, refreshed: 0, unchanged: 0 };
const refused: string[] = [];

for (const def of definitions) {
  const file = snapshotFile(def);
  const path = `${SNAPSHOT_DIR}${file}`;
  const rendered = renderSnapshot(def);
  if (!existsSync(path)) {
    writeFileSync(path, rendered);
    counts.created += 1;
    console.log(`created   ${file}`);
    continue;
  }
  const stored = readFileSync(path, "utf8");
  if (stored === rendered) {
    counts.unchanged += 1;
    continue;
  }
  const breaks = contractBreaks(JSON.parse(stored) as JsonSchema, JSON.parse(rendered) as JsonSchema);
  if (breaks.length > 0) {
    refused.push(`${file}\n    - ${breaks.join("\n    - ")}\n    Add ${def.name}.v${def.version + 1} with a compatibility handler for v${def.version}.`);
    continue;
  }
  writeFileSync(path, rendered);
  counts.refreshed += 1;
  console.log(`refreshed ${file} (widened)`);
}

const registered = new Set(definitions.map(snapshotFile));
const orphaned = readdirSync(SNAPSHOT_DIR).filter((file) => file.endsWith(".json") && !registered.has(file));

console.log(`\n${definitions.length} command versions: ${counts.created} created, ${counts.refreshed} refreshed, ${counts.unchanged} unchanged.`);
if (refused.length > 0) {
  console.error(`\nRefused to rewrite ${refused.length} narrowed shipped contract(s):\n  ${refused.join("\n  ")}`);
}
if (orphaned.length > 0) {
  console.error(`\nSnapshots with no registered handler (restore the handler; shipped versions must keep replaying):\n  ${orphaned.join("\n  ")}`);
}
if (refused.length > 0 || orphaned.length > 0) process.exit(1);
