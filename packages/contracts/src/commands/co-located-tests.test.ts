import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every command contract ships with its own test (AGENTS.md, "Adding a
 * command"). Shared helpers are not contracts. KNOWN_WITHOUT_TEST is a
 * baseline: it may only shrink, and a file that gains a test must leave it.
 */
const HELPERS = ["branch-fields.ts", "categories.ts", "queueability.ts"];
const KNOWN_WITHOUT_TEST = [
  "activity-close.ts",
  "activity-legs.ts",
  "add-or-renew-document.ts",
  "asset-lifecycle.ts",
  "create-activity.ts",
  "module-toggle.ts",
  "register-person.ts",
  "substitute-asset.ts",
];

const files = readdirSync(fileURLToPath(new URL(".", import.meta.url)));

describe("command contracts", () => {
  const contracts = files.filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !HELPERS.includes(f));
  const untested = contracts.filter((f) => !files.includes(f.replace(/\.ts$/, ".test.ts")));

  it("each ship with a co-located test", () => {
    expect(untested.filter((f) => !KNOWN_WITHOUT_TEST.includes(f))).toEqual([]);
  });

  it("drop out of the baseline once they have one", () => {
    expect(KNOWN_WITHOUT_TEST.filter((f) => !untested.includes(f))).toEqual([]);
  });
});
