import { randomUUID } from "node:crypto";
import { ROLES, type Role } from "@routiq/contracts";
import { describe, expect, it } from "vitest";
import "../server.js";
import { defaultApprovalRules } from "./approval-defaults.js";
import { listCommandDefinitions } from "./dispatcher.js";

/**
 * docs/reference/roles-and-access.md as data: one row per command, one column
 * per role, read off the ✓, S and A cells of its feature map. A cell here that
 * disagrees with a handler's `allowedRoles` fails, so changing who may run a
 * command means changing this table, the reference and the handler together.
 *
 * Columns: DIRECTOR, ADMIN, FINANCE, CASHIER, TECHNICIAN, DRIVER.
 */
const x = true;
const _ = false;
type Row = readonly [boolean, boolean, boolean, boolean, boolean, boolean];

const MATRIX: Readonly<Record<string, Row>> = {
  //                                      DIR ADM FIN CSH TEC DRV
  // Vehicles
  "register-asset":                      [x, x, _, _, _, _],
  "commission-asset":                    [x, x, _, _, _, _],
  "update-asset-details":                [x, x, _, _, _, _],
  "assign-asset":                        [x, x, x, _, _, _], // transfer: ADMIN submits, FINANCE/DIRECTOR approve
  "record-meter-reading":                [x, x, _, _, x, x],
  "add-note":                            [x, x, x, x, x, x],
  "add-or-renew-document":               [x, x, x, _, _, _],
  // Maintenance
  "report-issue":                        [x, x, _, _, x, x],
  "create-work-order":                   [x, x, _, _, x, _],
  "complete-work-order":                 [x, x, _, _, x, _],
  "cancel-work-order":                   [x, x, _, _, x, _],
  "approve-work-order":                  [x, x, _, _, _, _],
  "reject-work-order":                   [x, x, _, _, _, _],
  "approve-work-order-closure":          [x, x, _, _, _, _],
  "reject-work-order-completion":        [x, x, _, _, _, _],
  "resolve-issue":                       [x, x, _, _, x, _],
  "dismiss-issue":                       [x, x, _, _, x, _],
  "release-asset-to-service":            [x, x, _, _, _, _],
  // Trips
  "create-activity":                     [x, x, _, _, _, x],
  "record-movement-leg":                 [x, x, _, _, _, x],
  "record-journey-sheet":                [x, x, _, _, _, x],
  "record-haulage-job-sheet":            [x, x, _, _, _, x],
  "substitute-asset":                    [x, x, _, _, _, x],
  "close-activity":                      [x, x, _, _, _, x],
  "reopen-activity":                     [x, x, _, _, _, _],
  // Money
  "record-expense":                      [x, x, x, x, x, x], // TECHNICIAN: work-order lines only
  "update-pending-entry":                [x, x, x, x, x, x], // the author's own pending entry
  "record-revenue":                      [x, x, x, x, _, _],
  "attach-evidence":                     [x, x, x, x, x, x], // TECHNICIAN: work-order entries only
  "approve-entry":                       [x, _, x, _, _, _],
  "reject-entry":                        [x, _, x, _, _, _],
  "reverse-entry":                       [x, _, x, _, _, _],
  "lock-period":                         [x, _, x, _, _, _],
  "reopen-period":                       [x, _, _, _, _, _],
  // People
  "register-person":                     [x, x, _, _, _, _],
  "add-member":                          [x, x, _, _, _, _], // ADMIN: field roles in own branches
  "update-member-role":                  [x, x, _, _, _, _],
  "deactivate-member":                   [x, x, _, _, _, _],
  "reactivate-member":                   [x, x, _, _, _, _],
  "reset-member-pin":                    [x, x, _, _, _, _],
  // Settings
  "create-branch":                       [x, _, _, _, _, _],
  "rename-branch":                       [x, _, _, _, _, _],
  "set-branch-status":                   [x, _, _, _, _, _],
  "create-category":                     [x, _, _, _, _, _],
  "relabel-category":                    [x, _, _, _, _, _],
  "deactivate-category":                 [x, _, _, _, _, _],
  "reactivate-category":                 [x, _, _, _, _, _],
  "update-approval-threshold":           [x, _, _, _, _, _],
  "acknowledge-approval-rules":          [x, x, x, x, x, x], // each member their own notice (#422)
  "set-template-preset":                 [x, _, _, _, _, _],
  // Vendor-only per ADR-0005; DIRECTOR holds them until they move to platform scope.
  "enable-module":                       [x, _, _, _, _, _],
  "disable-module":                      [x, _, _, _, _, _],
};

function rolesOf(row: Row): Role[] {
  return ROLES.filter((_role, index) => row[index]);
}

describe("role × command matrix (docs/reference/roles-and-access.md)", () => {
  const workspaceCommands = listCommandDefinitions().filter((def) => def.scope !== "platform");

  it("covers every workspace command, and nothing that is not one", () => {
    const registered = [...new Set(workspaceCommands.map((def) => def.name))].sort();
    expect(registered).toEqual(Object.keys(MATRIX).sort());
  });

  for (const def of listCommandDefinitions()) {
    if (def.scope === "platform") continue;
    it(`${def.name}.v${def.version} allows exactly its row`, () => {
      const row = MATRIX[def.name];
      expect(row, `${def.name} has no row in MATRIX`).toBeDefined();
      expect([...def.allowedRoles].sort()).toEqual(rolesOf(row!).sort());
    });
  }

  it("gives every allowed role a catalog approval default, and no other role one", () => {
    const rules = defaultApprovalRules(randomUUID());
    for (const [command, row] of Object.entries(MATRIX)) {
      const withRule = [...new Set(rules.filter((r) => r.commandType === command).map((r) => r.requiredRole))].sort();
      expect(withRule, command).toEqual(rolesOf(row).sort());
    }
  });
});
