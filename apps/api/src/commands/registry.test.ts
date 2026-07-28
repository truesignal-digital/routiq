import { randomUUID } from "node:crypto";
import { COMMAND_QUEUEABILITY } from "@routiq/contracts";
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

  it("every registered command declares whether it may be queued offline", () => {
    const declared = new Set(Object.keys(COMMAND_QUEUEABILITY));
    for (const key of listCommands()) {
      const name = key.replace(/\.v\d+$/, "");
      expect(
        declared.has(name),
        `command "${name}" has no entry in COMMAND_QUEUEABILITY — §6 splits facts ` +
          `(queued and replayed) from decisions (always a server round trip), and an ` +
          `undeclared command defaults to a decision rather than being trusted to the outbox.`,
      ).toBe(true);
    }
  });
});
