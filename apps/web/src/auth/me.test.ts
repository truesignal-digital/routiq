// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { scopedByBranch } from "./me.js";

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
