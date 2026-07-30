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
    branch: {
      id: "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
      code: "HQ",
      name: "Headquarters",
    },
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
});
