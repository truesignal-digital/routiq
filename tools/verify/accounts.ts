/**
 * The logins `apps/api/scripts/seed-demo.ts` creates in the demo workspace.
 * accounts.test.ts reads that script and fails when this table drifts from it.
 */
export const DEMO_WORKSPACE = "transports-ngwa";

export interface DemoAccount {
  username: string;
  pin: string;
  role: string;
  displayName: string;
  aliases: readonly string[];
  branches: "ALL" | readonly string[];
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { username: "emilienne", pin: "111111", role: "ADMIN", displayName: "Émilienne", aliases: ["admin"], branches: "ALL" },
  { username: "boris", pin: "222222", role: "OPS_MANAGER", displayName: "Boris", aliases: ["manager", "ops"], branches: "ALL" },
  { username: "sali", pin: "333333", role: "FIELD_SUBMITTER", displayName: "Sali", aliases: ["field", "submitter"], branches: "ALL" },
  { username: "patrice", pin: "444444", role: "FIELD_SUBMITTER", displayName: "Patrice", aliases: ["field-yde"], branches: ["YDE"] },
  { username: "amadou", pin: "555555", role: "EXECUTIVE_VIEWER", displayName: "Amadou Bello", aliases: ["viewer", "executive"], branches: "ALL" },
  { username: "herve", pin: "666666", role: "MAINTENANCE", displayName: "Hervé Mbarga", aliases: ["maintenance", "mechanic"], branches: "ALL" },
  { username: "nadege", pin: "777777", role: "FINANCE_APPROVER", displayName: "Nadège Fotso", aliases: ["finance", "approver"], branches: "ALL" },
];

/** Accepts a username, a role code (first account with it), or an alias, case-insensitively. */
export function resolveAccount(who: string): DemoAccount {
  const key = who.trim().toLowerCase();
  const match =
    DEMO_ACCOUNTS.find((a) => a.username === key) ??
    DEMO_ACCOUNTS.find((a) => a.role.toLowerCase() === key) ??
    DEMO_ACCOUNTS.find((a) => a.aliases.includes(key));
  if (match === undefined) {
    const known = DEMO_ACCOUNTS.map((a) => `${a.username} (${a.role}; ${a.aliases.join(", ")})`).join("\n  ");
    throw new Error(`unknown role or user "${who}". Known:\n  ${known}`);
  }
  return match;
}
