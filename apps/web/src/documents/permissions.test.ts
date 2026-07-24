import { describe, expect, it } from "vitest";
import { canAccessDocuments, canManageDocuments } from "./permissions.js";

describe("documents permissions", () => {
  it("allows writes only to roles accepted by add-or-renew-document", () => {
    for (const role of ["ADMIN", "OPS_MANAGER", "FIELD_SUBMITTER"] as const) {
      expect(canManageDocuments(role, ["CORE", "DOCUMENTS"])).toBe(true);
    }
    for (const role of ["MAINTENANCE", "FINANCE_APPROVER", "EXECUTIVE_VIEWER"] as const) {
      expect(canManageDocuments(role, ["CORE", "DOCUMENTS"])).toBe(false);
    }
  });

  it("does not expose documents when the module is disabled", () => {
    expect(canAccessDocuments(["CORE", "ASSETS"])).toBe(false);
    expect(canManageDocuments("ADMIN", ["CORE", "ASSETS"])).toBe(false);
  });
});
