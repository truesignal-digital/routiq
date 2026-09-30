import { writeFileSync, readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const snapshotDir = join(__dir, "apps/api/src/commands/contract-snapshots");

// Import and load commands
const { listCommandDefinitions } = await import(
  join(__dir, "apps/api/src/commands/dispatcher.js")
);

// Import Zod
const { z } = await import("zod");

const defs = listCommandDefinitions();

console.log(`Generating snapshots for ${defs.length} commands...`);

for (const def of defs) {
  const key = `${def.name}.v${def.version}`;
  const snapshotPath = join(snapshotDir, `${key}.json`);

  const schema = z.toJSONSchema(def.payloadSchema, {
    io: "input",
    unrepresentable: "any",
  });

  const content = `${JSON.stringify(schema, null, 2)}\n`;

  writeFileSync(snapshotPath, content);
  console.log(`  ✓ ${key}`);
}

// Check for orphaned snapshots
const registered = new Set(defs.map((d) => `${d.name}.v${d.version}.json`));
const files = readdirSync(snapshotDir);
const orphaned = files.filter((f) => f.endsWith(".json") && !registered.has(f));

if (orphaned.length > 0) {
  console.log("\nOrphaned snapshots (handlers lost):");
  for (const f of orphaned) {
    console.log(`  ✗ ${f}`);
  }
}

console.log("\nDone!");
