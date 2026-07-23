// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isReadOnlyRole, scopedByBranch } from "./me.js";

describe("role gate", () => {
  it("EXECUTIVE_VIEWER is read-only; operating roles are not", () => {
    expect(isReadOnlyRole("EXECUTIVE_VIEWER")).toBe(true);
    expect(isReadOnlyRole(undefined)).toBe(true);
    for (const role of ["ADMIN", "OPS_MANAGER", "FIELD_SUBMITTER", "MAINTENANCE", "FINANCE_APPROVER"] as const) {
      expect(isReadOnlyRole(role)).toBe(false);
    }
  });
});

describe("branch gate", () => {
  const branches = [
    { id: "b1", code: "DLA" },
    { id: "b2", code: "YDE" },
  ];

  it("ALL scope sees everything", () => {
    expect(scopedByBranch("ALL", branches, (b) => b.id)).toHaveLength(2);
  });

  it("scoped members see only their branches", () => {
    expect(scopedByBranch(["b2"], branches, (b) => b.id)).toEqual([{ id: "b2", code: "YDE" }]);
  });
});
