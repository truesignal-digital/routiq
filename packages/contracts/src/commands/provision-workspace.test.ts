import { describe, expect, it } from "vitest";
import { provisionWorkspaceCommand } from "./provision-workspace.js";

const valid = {
  name: "provision-workspace",
  version: 1,
  envelope: {
    commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    idempotencyKey: "tenant3-initial",
    origin: "API",
    sourceArtifactIds: [],
  },
  payload: {
    workspace: {
      id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      slug: "tenant3",
      name: "Tenant 3",
    },
    branches: [
      {
        id: "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
        code: "HQ",
        name: "Headquarters",
      },
    ],
    admin: {
      id: "6ba7b812-9dad-11d1-80b4-00c04fd430c8",
      displayName: "Admin User",
      username: "admin",
      pin: "1234",
    },
    enabledPresets: ["TRUCKING"],
  },
};

describe("provision-workspace contract", () => {
  it("accepts a valid command", () => {
    expect(provisionWorkspaceCommand.parse(valid).payload.workspace.slug).toBe("tenant3");
  });

  it("rejects empty slug", () => {
    const bad = structuredClone(valid);
    bad.payload.workspace.slug = "";
    expect(provisionWorkspaceCommand.safeParse(bad).success).toBe(false);
  });

  it("rejects slug exceeding 80 characters", () => {
    const bad = structuredClone(valid);
    bad.payload.workspace.slug = "a".repeat(81);
    expect(provisionWorkspaceCommand.safeParse(bad).success).toBe(false);
  });

  it("rejects slug with uppercase letters", () => {
    const bad = structuredClone(valid);
    bad.payload.workspace.slug = "Tenant3";
    expect(provisionWorkspaceCommand.safeParse(bad).success).toBe(false);
  });

  it("rejects slug with spaces", () => {
    const bad = structuredClone(valid);
    bad.payload.workspace.slug = "tenant 3";
    expect(provisionWorkspaceCommand.safeParse(bad).success).toBe(false);
  });

  it("accepts slug with hyphens", () => {
    const good = structuredClone(valid);
    good.payload.workspace.slug = "tenant-3";
    expect(provisionWorkspaceCommand.safeParse(good).success).toBe(true);
  });

  it("requires at least one enabled preset", () => {
    const bad = structuredClone(valid);
    bad.payload.enabledPresets = [];
    expect(provisionWorkspaceCommand.safeParse(bad).success).toBe(false);
  });

  it("accepts valid disabledModules", () => {
    const good = structuredClone(valid);
    (good.payload as any).disabledModules = ["ASSETS"];
    const result = provisionWorkspaceCommand.safeParse(good);
    expect(result.success).toBe(true);
  });

  it("rejects missing admin username", () => {
    const bad = structuredClone(valid);
    const admin: any = bad.payload.admin;
    delete admin.username;
    expect(provisionWorkspaceCommand.safeParse(bad).success).toBe(false);
  });

  it("rejects PIN shorter than 4 characters", () => {
    const bad = structuredClone(valid);
    bad.payload.admin.pin = "123";
    expect(provisionWorkspaceCommand.safeParse(bad).success).toBe(false);
  });

  it("rejects PIN exceeding 64 characters", () => {
    const bad = structuredClone(valid);
    bad.payload.admin.pin = "a".repeat(65);
    expect(provisionWorkspaceCommand.safeParse(bad).success).toBe(false);
  });

  it("accepts provisioned users with role and branch scopes", () => {
    const good = structuredClone(valid);
    (good.payload as any).users = [
      {
        id: "6ba7b813-9dad-11d1-80b4-00c04fd430c8",
        displayName: "Operations Manager",
        username: "ops",
        pin: "5678",
        role: "OPS_MANAGER",
        branchScope: "ALL",
      },
      {
        id: "6ba7b814-9dad-11d1-80b4-00c04fd430c8",
        displayName: "Field Agent",
        username: "field",
        pin: "9012",
        role: "FIELD_SUBMITTER",
        branchScope: ["HQ"],
      },
    ];

    expect(provisionWorkspaceCommand.safeParse(good).success).toBe(true);
  });

  it("accepts several branches, each with its own timezone", () => {
    const good = structuredClone(valid);
    (good.payload as any).branches = [
      { id: "6ba7b811-9dad-11d1-80b4-00c04fd430c8", code: "DLA", name: "Douala" },
      { id: "6ba7b815-9dad-11d1-80b4-00c04fd430c8", code: "YDE", name: "Yaoundé" },
      {
        id: "6ba7b816-9dad-11d1-80b4-00c04fd430c8",
        code: "BAF",
        name: "Bafoussam",
        timezone: "Africa/Douala",
      },
    ];

    const result = provisionWorkspaceCommand.safeParse(good);
    expect(result.success).toBe(true);
  });

  it("requires at least one branch", () => {
    const bad = structuredClone(valid);
    bad.payload.branches = [];
    expect(provisionWorkspaceCommand.safeParse(bad).success).toBe(false);
  });

  it("rejects more than 20 branches", () => {
    const bad = structuredClone(valid);
    bad.payload.branches = Array.from({ length: 21 }, (_, index) => ({
      id: `6ba7b811-9dad-11d1-80b4-00c04fd4${String(index).padStart(4, "0")}`,
      code: `B${String(index).padStart(2, "0")}`,
      name: `Branch ${index}`,
    }));
    expect(provisionWorkspaceCommand.safeParse(bad).success).toBe(false);
  });

  /** The payload-side half of the (workspace_id, code) unique index. */
  it("rejects duplicate branch codes within the payload", () => {
    const bad = structuredClone(valid);
    bad.payload.branches = [
      { id: "6ba7b811-9dad-11d1-80b4-00c04fd430c8", code: "DLA", name: "Douala" },
      { id: "6ba7b815-9dad-11d1-80b4-00c04fd430c8", code: "DLA", name: "Douala Bonabéri" },
    ];

    const result = provisionWorkspaceCommand.safeParse(bad);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path.join(".") === "payload.branches.1.code")).toBe(
      true,
    );
  });

  /** The payload-side half of `branches_pkey`. */
  it("rejects duplicate branch ids within the payload", () => {
    const bad = structuredClone(valid);
    bad.payload.branches = [
      { id: "6ba7b811-9dad-11d1-80b4-00c04fd430c8", code: "DLA", name: "Douala" },
      { id: "6ba7b811-9dad-11d1-80b4-00c04fd430c8", code: "YDE", name: "Yaoundé" },
    ];

    const result = provisionWorkspaceCommand.safeParse(bad);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path.join(".") === "payload.branches.1.id")).toBe(
      true,
    );
  });

  it("names both the duplicated id and the duplicated code on the same entry", () => {
    const bad = structuredClone(valid);
    bad.payload.branches = [
      { id: "6ba7b811-9dad-11d1-80b4-00c04fd430c8", code: "DLA", name: "Douala" },
      { id: "6ba7b811-9dad-11d1-80b4-00c04fd430c8", code: "DLA", name: "Douala" },
    ];

    const result = provisionWorkspaceCommand.safeParse(bad);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("payload.branches.1.code");
    expect(paths).toContain("payload.branches.1.id");
  });

  /** The payload-side half of the (workspace_id, name) unique index. */
  it("rejects duplicate branch names within the payload", () => {
    const bad = structuredClone(valid);
    bad.payload.branches = [
      { id: "6ba7b811-9dad-11d1-80b4-00c04fd430c8", code: "CTR", name: "Centre" },
      { id: "6ba7b815-9dad-11d1-80b4-00c04fd430c8", code: "CTR2", name: "Centre" },
    ];

    const result = provisionWorkspaceCommand.safeParse(bad);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path.join(".") === "payload.branches.1.name")).toBe(
      true,
    );
  });

  it("rejects a whitespace-only branch name", () => {
    const bad = structuredClone(valid);
    bad.payload.branches[0]!.name = "   ";
    expect(provisionWorkspaceCommand.safeParse(bad).success).toBe(false);
  });

  it("trims a padded branch name rather than persisting the padding", () => {
    const good = structuredClone(valid);
    good.payload.branches[0]!.name = "  Headquarters  ";
    expect(provisionWorkspaceCommand.parse(good).payload.branches[0]!.name).toBe("Headquarters");
  });

  it("rejects a lowercase branch code", () => {
    const bad = structuredClone(valid);
    bad.payload.branches[0]!.code = "dla";
    expect(provisionWorkspaceCommand.safeParse(bad).success).toBe(false);
  });

  it("rejects a provisioned user with an unknown role", () => {
    const bad = structuredClone(valid);
    (bad.payload as any).users = [
      {
        id: "6ba7b813-9dad-11d1-80b4-00c04fd430c8",
        displayName: "Unknown Role",
        username: "unknown",
        pin: "5678",
        role: "OWNER",
        branchScope: "ALL",
      },
    ];

    expect(provisionWorkspaceCommand.safeParse(bad).success).toBe(false);
  });
});
