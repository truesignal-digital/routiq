import { describe, expect, it } from "vitest";
import {
  ADMIN_GRANTABLE_ROLES,
  canBookWorkOrderCost,
  canReadEntries,
  canReadLedger,
  canReadWorkOrderCosts,
  DOCUMENT_READER_ROLES,
  ENTRY_READER_ROLES,
  grantableRoles,
  LEDGER_READER_ROLES,
  LEGACY_ROLE_MAP,
  legacyRoleInput,
  MONEY_READ_SCOPE,
  readsOwnTripsOnly,
  TRIP_READ_SCOPE,
  ROLES,
} from "./roles.js";

describe("role registry", () => {
  it("has exactly the six team roles of ADR-0009", () => {
    expect(ROLES).toEqual(["DIRECTOR", "ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"]);
  });

  it("maps every legacy role and promotes nobody to DIRECTOR", () => {
    expect(LEGACY_ROLE_MAP).toEqual({
      ADMIN: "ADMIN",
      OPS_MANAGER: "ADMIN",
      EXECUTIVE_VIEWER: "ADMIN",
      FIELD_SUBMITTER: "DRIVER",
      MAINTENANCE: "TECHNICIAN",
      FINANCE_APPROVER: "FINANCE",
    });
    expect(Object.values(LEGACY_ROLE_MAP)).not.toContain("DIRECTOR");
  });

  it("reads a legacy code in a v1 payload as the role it became", () => {
    expect(legacyRoleInput.parse("OPS_MANAGER")).toBe("ADMIN");
    expect(legacyRoleInput.parse("FIELD_SUBMITTER")).toBe("DRIVER");
    expect(legacyRoleInput.parse("ADMIN")).toBe("ADMIN");
    // A shipped version accepts exactly what it shipped with: no new codes.
    expect(legacyRoleInput.safeParse("CASHIER").success).toBe(false);
    expect(legacyRoleInput.safeParse("DIRECTOR").success).toBe(false);
  });

  it("lets DIRECTOR grant every role but DIRECTOR, and ADMIN only the field roles", () => {
    // Direction is appointed by the vendor or at provisioning, never by a tenant (ADR-0009).
    expect(grantableRoles("DIRECTOR")).toEqual(ROLES.filter((role) => role !== "DIRECTOR"));
    expect(grantableRoles("ADMIN")).toEqual(ADMIN_GRANTABLE_ROLES);
    expect(ADMIN_GRANTABLE_ROLES).toEqual(["DRIVER", "TECHNICIAN", "CASHIER"]);
    for (const role of ["FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"] as const) {
      expect(grantableRoles(role)).toEqual([]);
    }
  });

  it("gives each role the money scope of the roles reference", () => {
    expect(MONEY_READ_SCOPE).toEqual({
      DIRECTOR: "LEDGER",
      ADMIN: "LEDGER",
      FINANCE: "LEDGER",
      CASHIER: "BRANCH_ENTRIES",
      TECHNICIAN: "WORK_ORDER_COSTS",
      DRIVER: "OWN_ENTRIES",
    });
  });

  it("narrows only the driver to their own trips (#545)", () => {
    expect(ROLES.filter(readsOwnTripsOnly)).toEqual(["DRIVER"]);
    expect(TRIP_READ_SCOPE.DRIVER).toBe("OWN_TRIPS");
  });

  it("derives the role lists from the scope, so they cannot drift", () => {
    expect(LEDGER_READER_ROLES).toEqual(ROLES.filter(canReadLedger));
    expect(ENTRY_READER_ROLES).toEqual(ROLES.filter(canReadEntries));
    expect(ROLES.filter(canReadEntries)).toEqual(
      ROLES.filter((role) => MONEY_READ_SCOPE[role] !== "WORK_ORDER_COSTS"),
    );
    expect(DOCUMENT_READER_ROLES).toEqual(ROLES.filter((role) => role !== "CASHIER"));
  });

  it("gives work-order money to every role but the driver (#390)", () => {
    expect(ROLES.filter(canReadWorkOrderCosts)).toEqual([
      "DIRECTOR",
      "ADMIN",
      "FINANCE",
      "CASHIER",
      "TECHNICIAN",
    ]);
  });

  it("lets only the workshop and the managers book cost on a work order (#410, #414)", () => {
    expect(ROLES.filter(canBookWorkOrderCost)).toEqual(["DIRECTOR", "ADMIN", "TECHNICIAN"]);
  });
});
