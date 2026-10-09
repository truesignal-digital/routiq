import { randomUUID } from "node:crypto";
import { COMMAND_QUEUEABILITY, commandScopeViolations, type ScopeTargetDeclaration } from "@routiq/contracts";
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

  /**
   * #152: authority (workspace, actor, the actor's branch scope) comes from the
   * session only. Every registered workspace AND platform schema, every version,
   * nested fields included, is walked by the same check the planted schemas in
   * packages/contracts/src/client-scope.test.ts prove fires.
   */
  it("never lets a payload name the caller's workspace, identity or scope, and declares every target id", () => {
    const registered = listCommandDefinitions().map((def) => ({
      command: `${def.name}.v${def.version}`,
      schema: def.payloadSchema,
    }));
    expect(commandScopeViolations(registered, SCOPE_TARGETS)).toEqual([]);
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

/**
 * Identity-shaped fields that name the record a command acts on, never the
 * caller. Each is resolved inside the server-derived workspace (a foreign id is
 * not found), and the ones that file a record under a branch are checked
 * against the caller's own branch scope by `branchAuthorization`.
 */
const SCOPE_TARGETS: readonly ScopeTargetDeclaration[] = [
  {
    path: "branchCode",
    commands: [
      "register-asset.v1",
      "register-asset.v2",
      "assign-asset.v1",
      "record-expense.v1",
      "record-revenue.v1",
      "register-person.v1",
      "create-activity.v1",
      "record-journey-sheet.v1",
      "record-haulage-job-sheet.v1",
    ],
    meaning: "the branch the record is filed under or moved to; branchAuthorization checks it against the caller's scope",
  },
  {
    path: "branchId",
    commands: ["create-branch.v1", "rename-branch.v1", "set-branch-status.v1"],
    meaning: "the branch being created, renamed or (de)activated; DIRECTOR-only, looked up in the caller's workspace",
  },
  {
    path: "custodianMembershipId",
    commands: ["assign-asset.v1"],
    meaning: "the member assigned as the vehicle's driver, looked up in the caller's workspace",
  },
  {
    path: "defaultRole",
    commands: ["register-person.v1"],
    meaning: "the job the registered person usually does, not an access role",
  },
  {
    path: "crew[].role",
    commands: ["create-activity.v1", "record-journey-sheet.v1", "record-haulage-job-sheet.v1"],
    meaning: "what a crew member did on the trip (DRIVER, CONDUCTOR...), not an access role",
  },
  {
    path: "extraSegments[].role",
    commands: ["record-journey-sheet.v1", "record-haulage-job-sheet.v1"],
    meaning: "what an extra vehicle did on the trip, not an access role",
  },
  {
    path: "principalId",
    commands: [
      "add-member.v1",
      "add-member.v2",
      "update-member-role.v1",
      "update-member-role.v2",
      "deactivate-member.v1",
      "reactivate-member.v1",
      "reset-member-pin.v1",
    ],
    meaning: "the member being added or administered, never the actor (ctx.principalId)",
  },
  {
    path: "role",
    commands: ["add-member.v1", "add-member.v2", "update-member-role.v1", "update-member-role.v2"],
    meaning: "the role granted to the target member; assertMayManage refuses a role the caller may not grant",
  },
  {
    path: "branchScope",
    commands: ["add-member.v1", "add-member.v2", "update-member-role.v1", "update-member-role.v2"],
    meaning: "the branches the target member may work in; assertMayManage refuses any outside the caller's own scope",
  },
  {
    path: "workspace",
    commands: ["provision-workspace.v1", "provision-workspace.v2", "provision-workspace.v3"],
    meaning: "the workspace a vendor operator is creating (platform scope, operator session)",
  },
  {
    path: "users[].role",
    commands: ["provision-workspace.v1", "provision-workspace.v2", "provision-workspace.v3"],
    meaning: "the role of a first user of the workspace being provisioned",
  },
  {
    path: "users[].branchScope",
    commands: ["provision-workspace.v1", "provision-workspace.v2", "provision-workspace.v3"],
    meaning: "the branches a first user of the workspace being provisioned may work in",
  },
  {
    path: "workspaceSlug",
    commands: ["appoint-director.v1"],
    meaning: "the workspace whose director a vendor operator appoints (platform scope, operator session)",
  },
  {
    path: "workspaceSlug",
    commands: ["enable-module.v2", "disable-module.v2", "set-template-preset.v2"],
    meaning: "the workspace whose modules or presets a vendor operator changes (platform scope, operator session; ADR-0005)",
  },
];

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
