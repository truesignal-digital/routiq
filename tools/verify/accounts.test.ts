import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_ACCOUNTS, DEMO_WORKSPACE, resolveAccount } from "./accounts.js";
import { REPO_ROOT } from "./slot.js";

const seed = readFileSync(path.join(REPO_ROOT, "apps/api/scripts/seed-demo.ts"), "utf8");

describe("DEMO_ACCOUNTS", () => {
  it("matches every login seed-demo.ts creates", () => {
    const seeded = [...seed.matchAll(/username: "([a-z]+)",\s*displayName: "([^"]+)",\s*pin: "(\d+)",\s*role: "([A-Z_]+)"/g)].map(
      ([, username, displayName, pin, role]) => ({ username, displayName, pin, role }),
    );
    expect(seeded.length).toBeGreaterThan(0);
    expect(DEMO_ACCOUNTS.map(({ username, displayName, pin, role }) => ({ username, displayName, pin, role })).sort((a, b) => a.username.localeCompare(b.username))).toEqual(
      seeded.sort((a, b) => (a.username ?? "").localeCompare(b.username ?? "")),
    );
    expect(seed).toContain(`const demoWorkspaceSlug = "${DEMO_WORKSPACE}"`);
  });
});

describe("resolveAccount", () => {
  it("finds an account by username, role code or alias", () => {
    expect(resolveAccount("boris").role).toBe("OPS_MANAGER");
    expect(resolveAccount("manager").username).toBe("boris");
    expect(resolveAccount("FINANCE_APPROVER").username).toBe("nadege");
    expect(resolveAccount("field_submitter").username).toBe("sali");
  });

  it("lists the known accounts when it cannot resolve one", () => {
    expect(() => resolveAccount("owner")).toThrow(/emilienne/);
  });
});
