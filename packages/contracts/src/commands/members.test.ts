import { describe, expect, it } from "vitest";
import {
  addMemberPayload,
  deactivateMemberPayload,
  resetMemberPinPayload,
  updateMemberRolePayload,
} from "./members.js";

describe("member command payloads", () => {
  const principalId = "3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8";

  it("accepts a member scoped to named branches", () => {
    const branchId = "9c8d7e6f-5a4b-4c3d-9e1f-0a1b2c3d4e5f";
    const parsed = addMemberPayload.parse({
      principalId,
      displayName: "Adamou Bello",
      username: "adamou",
      pin: "4821",
      role: "FIELD_SUBMITTER",
      branchScope: [branchId],
    });
    expect(parsed.branchScope).toEqual([branchId]);
  });

  it("accepts ALL as a branch scope", () => {
    const parsed = addMemberPayload.parse({
      principalId,
      displayName: "Sali Ngono",
      username: "sali",
      pin: "4821",
      role: "ADMIN",
      branchScope: "ALL",
    });
    expect(parsed.branchScope).toBe("ALL");
  });

  it("rejects an empty explicit branch scope, which means nothing rather than everything", () => {
    const result = addMemberPayload.safeParse({
      principalId,
      displayName: "Sali Ngono",
      username: "sali",
      pin: "4821",
      role: "ADMIN",
      branchScope: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a branch scope of codes, since these commands take ids", () => {
    const result = addMemberPayload.safeParse({
      principalId,
      displayName: "Sali Ngono",
      username: "sali",
      pin: "4821",
      role: "ADMIN",
      branchScope: ["DLA"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a role outside the fixed registry", () => {
    const result = addMemberPayload.safeParse({
      principalId,
      displayName: "Sali Ngono",
      username: "sali",
      pin: "4821",
      role: "SUPERUSER",
      branchScope: "ALL",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a PIN shorter than four digits", () => {
    const result = addMemberPayload.safeParse({
      principalId,
      displayName: "Sali Ngono",
      username: "sali",
      pin: "12",
      role: "ADMIN",
      branchScope: "ALL",
    });
    expect(result.success).toBe(false);
  });

  it("takes a role change, a scope change, or both", () => {
    expect(
      updateMemberRolePayload.safeParse({ principalId, role: "OPS_MANAGER" }).success,
    ).toBe(true);
    expect(
      updateMemberRolePayload.safeParse({ principalId, branchScope: "ALL" }).success,
    ).toBe(true);
    expect(
      updateMemberRolePayload.safeParse({
        principalId,
        role: "OPS_MANAGER",
        branchScope: "ALL",
      }).success,
    ).toBe(true);
  });

  it("rejects an update that changes nothing", () => {
    expect(updateMemberRolePayload.safeParse({ principalId }).success).toBe(false);
  });

  it("keeps the lifecycle payloads to the member alone", () => {
    expect(deactivateMemberPayload.parse({ principalId })).toEqual({ principalId });
    expect(
      deactivateMemberPayload.safeParse({ principalId, reason: "quit" }).success,
    ).toBe(false);
  });

  it("carries the new PIN and nothing else on a reset", () => {
    expect(resetMemberPinPayload.parse({ principalId, pin: "9137" })).toEqual({
      principalId,
      pin: "9137",
    });
  });
});
