import { randomUUID } from "node:crypto";
import { COMMAND_QUEUEABILITY } from "@routiq/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import "../server.js";
import { defaultApprovalRules } from "./approval-defaults.js";
import { listCommandDefinitions } from "./dispatcher.js";

/**
 * Convention guards: violations here mean a new command was wired incompletely,
 * not that runtime behavior regressed.
 *
 * Both invariants are about tenant data — an approval rule and an outbox entry
 * are things a workspace has. Platform-scope commands are exempt from each, and
 * the exemption is asserted rather than skipped: a platform command that grew an
 * approval default or an offline declaration would mean someone had started
 * treating provisioning as a workspace command.
 */
describe("command registry conventions", () => {
  const workspaceCommands = listCommandDefinitions().filter((def) => def.scope !== "platform");
  const platformCommands = listCommandDefinitions().filter((def) => def.scope === "platform");
  const approvalDefaults = new Set(defaultApprovalRules(randomUUID()).map((r) => r.commandType));
  const queueabilityDeclarations = new Set(Object.keys(COMMAND_QUEUEABILITY));

  it("every workspace command has a catalog default approval rule", () => {
    for (const { name } of workspaceCommands) {
      expect(
        approvalDefaults.has(name),
        `command "${name}" has no row in approval-defaults.ts — with no matching rule ` +
          `every call is rejected APPROVAL_REQUIRED (safe default). Add its catalog default.`,
      ).toBe(true);
    }
  });

  it("every workspace command declares whether it may be queued offline", () => {
    for (const { name } of workspaceCommands) {
      expect(
        queueabilityDeclarations.has(name),
        `command "${name}" has no entry in COMMAND_QUEUEABILITY — §6 splits facts ` +
          `(queued and replayed) from decisions (always a server round trip), and an ` +
          `undeclared command defaults to a decision rather than being trusted to the outbox.`,
      ).toBe(true);
    }
  });

  it("platform commands carry neither an approval default nor an offline declaration", () => {
    for (const { name } of platformCommands) {
      expect(
        approvalDefaults.has(name),
        `platform command "${name}" has a row in approval-defaults.ts — approval rules are ` +
          `per-workspace data and the dispatcher never evaluates them for platform scope.`,
      ).toBe(false);
      expect(
        queueabilityDeclarations.has(name),
        `platform command "${name}" is declared in COMMAND_QUEUEABILITY — platform commands ` +
          `run from the vendor CLI, never from a client outbox.`,
      ).toBe(false);
    }
  });

  it("names every command in kebab-case with a positive integer version", () => {
    const malformed = listCommandDefinitions()
      .filter((def) => !/^[a-z]+(-[a-z]+)*$/.test(def.name) || !Number.isInteger(def.version) || def.version < 1)
      .map((def) => `${def.name}.v${def.version}`);
    expect(malformed).toEqual([]);
  });

  it("never lets a workspace payload name the tenant or the actor (the server derives both)", () => {
    const offenders = workspaceCommands.flatMap((def) => {
      const keys = Object.keys(topLevelProperties(def.payloadSchema));
      return keys.filter((key) => /^(workspaceId|tenantId|actorId)$/.test(key)).map((key) => `${def.name}: ${key}`);
    });
    expect(offenders).toEqual([]);
  });

  it("makes every command that writes against an asset refuse sold, retired and written-off ones", () => {
    const unguarded = workspaceCommands
      .filter((def) => Object.keys(topLevelProperties(def.payloadSchema)).some((key) => /assetId$/i.test(key)))
      .filter((def) => def.operationalAssetId === undefined && !(`${def.name}.v${def.version}` in ASSET_GUARD_EXEMPT))
      .map((def) => `${def.name}.v${def.version}`);
    expect(
      unguarded,
      "declare operationalAssetId, or add the command to ASSET_GUARD_EXEMPT with the reason it is safe",
    ).toEqual([]);
  });
});

/** Commands with an asset in their payload that legitimately skip the dispatcher's terminal-status check. */
const ASSET_GUARD_EXEMPT: Record<string, string> = {
  "register-asset.v1": "creates the asset; there is no status to check yet",
  "register-asset.v2": "creates the asset; there is no status to check yet",
  "commission-asset.v1": "the transition itself accepts only REGISTERED assets (asset-lifecycle.ts)",
  "record-journey-sheet.v1": "multi-asset; sheet-writer.ts refuses every terminal asset the sheet touches",
  "record-haulage-job-sheet.v1": "multi-asset; sheet-writer.ts refuses every terminal asset the sheet touches",
};

function topLevelProperties(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as { properties?: Record<string, unknown> };
  return json.properties ?? {};
}
