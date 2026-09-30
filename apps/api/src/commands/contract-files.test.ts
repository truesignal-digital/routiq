import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every command contract ships with its own test (AGENTS.md, "Adding a
 * command"). Lives here rather than in @routiq/contracts, which stays free of
 * Node APIs. Shared helpers are not contracts. KNOWN_WITHOUT_TEST is a
 * baseline: it may only shrink, and a file that gains a test must leave it.
 */
const CONTRACTS_DIR = fileURLToPath(new URL("../../../../packages/contracts/src/commands/", import.meta.url));
const HELPERS = ["branch-fields.ts", "categories.ts", "queueability.ts"];
const KNOWN_WITHOUT_TEST = [
  "activity-close.ts",
  "activity-legs.ts",
  "add-or-renew-document.ts",
  "create-activity.ts",
  "module-toggle.ts",
  "register-person.ts",
  "substitute-asset.ts",
];

describe("command contract files", () => {
  const files = readdirSync(CONTRACTS_DIR);
  const contracts = files.filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !HELPERS.includes(file));
  const untested = contracts.filter((file) => !files.includes(file.replace(/\.ts$/, ".test.ts")));

  it("each ship with a co-located test", () => {
    expect(untested.filter((file) => !KNOWN_WITHOUT_TEST.includes(file))).toEqual([]);
  });

  it("drop out of the baseline once they have one", () => {
    expect(KNOWN_WITHOUT_TEST.filter((file) => !untested.includes(file))).toEqual([]);
  });
});
