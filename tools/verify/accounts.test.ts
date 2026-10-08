import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_ACCOUNTS, DEMO_WORKSPACE, PASSENGER_WORKSPACE, resolveAccount } from "./accounts.js";
import { REPO_ROOT } from "./slot.js";

function seededLogins(file: string) {
  const seed = readFileSync(path.join(REPO_ROOT, "apps/api/scripts", file), "utf8");
  const workspace = /const demoWorkspaceSlug = "([a-z-]+)"/.exec(seed)?.[1];
  const logins = [...seed.matchAll(/username: "([a-z]+)",\s*displayName: "([^"]+)",\s*pin: "(\d+)",\s*role: "([A-Z_]+)"/g)].map(
    ([, username, displayName, pin, role]) => ({ workspace, username, displayName, pin, role }),
  );
  return { workspace, logins };
}

const byWorkspaceAndName = (a: { workspace?: string | undefined; username?: string | undefined }, b: { workspace?: string | undefined; username?: string | undefined }) =>
  `${a.workspace}/${a.username}`.localeCompare(`${b.workspace}/${b.username}`);

describe("DEMO_ACCOUNTS", () => {
  it("matches every login the demo seed creates, in each workspace", () => {
    const trucking = seededLogins("seed-demo.ts");
    const passenger = seededLogins("seed-demo-passenger.ts");
    expect(trucking.workspace).toBe(DEMO_WORKSPACE);
    expect(passenger.workspace).toBe(PASSENGER_WORKSPACE);
    expect(trucking.logins.length).toBeGreaterThan(0);
    expect(passenger.logins).toHaveLength(6);
    expect(
      DEMO_ACCOUNTS.map(({ workspace, username, displayName, pin, role }) => ({ workspace, username, displayName, pin, role })).sort(byWorkspaceAndName),
    ).toEqual([...trucking.logins, ...passenger.logins].sort(byWorkspaceAndName));
  });

  it("keeps usernames unique across workspaces, so a username resolves to one login", () => {
    const names = DEMO_ACCOUNTS.map((account) => account.username);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("resolveAccount", () => {
  it("finds an account by username, role code or alias", () => {
    expect(resolveAccount("boris").role).toBe("ADMIN");
    expect(resolveAccount("manager").username).toBe("boris");
    expect(resolveAccount("FINANCE").username).toBe("nadege");
    expect(resolveAccount("driver").username).toBe("sali");
  });

  it("signs in as each of the six roles by its code", () => {
    expect(
      ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"].map((role) => resolveAccount(role).username),
    ).toEqual(["emilienne", "boris", "nadege", "clarisse", "herve", "sali"]);
  });

  it("reaches the passenger workspace through its passenger- aliases", () => {
    expect(
      ["director", "admin", "finance", "cashier", "technician", "driver"].map((role) => {
        const account = resolveAccount(`passenger-${role}`);
        return [account.workspace, account.username];
      }),
    ).toEqual([
      [PASSENGER_WORKSPACE, "josiane"],
      [PASSENGER_WORKSPACE, "paul"],
      [PASSENGER_WORKSPACE, "aline"],
      [PASSENGER_WORKSPACE, "grace"],
      [PASSENGER_WORKSPACE, "bertrand"],
      [PASSENGER_WORKSPACE, "eric"],
    ]);
    expect(resolveAccount("DIRECTOR").workspace).toBe(DEMO_WORKSPACE);
  });

  it("lists the known accounts when it cannot resolve one", () => {
    expect(() => resolveAccount("superboss")).toThrow(/emilienne/);
  });
});
