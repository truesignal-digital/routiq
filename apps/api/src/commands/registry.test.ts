import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import "../server.js";
import { defaultApprovalRules } from "./approval-defaults.js";
import { listCommands } from "./dispatcher.js";

/**
 * Convention guards: violations here mean a new command was wired incompletely,
 * not that runtime behavior regressed.
 */
describe("command registry conventions", () => {
  it("every registered command has a catalog default approval rule", () => {
    const covered = new Set(defaultApprovalRules(randomUUID()).map((r) => r.commandType));
    for (const key of listCommands()) {
      const name = key.replace(/\.v\d+$/, "");
      expect(
        covered.has(name),
        `command "${name}" has no row in approval-defaults.ts — with no matching rule ` +
          `every call is rejected APPROVAL_REQUIRED (safe default). Add its catalog default.`,
      ).toBe(true);
    }
  });
});
