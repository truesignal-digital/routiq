/**
 * The logins `apps/api/scripts/seed-demo.ts` creates: the trucking demo
 * workspace, and the passenger one from `seed-demo-passenger.ts`.
 * accounts.test.ts reads those scripts and fails when this table drifts.
 */
export const DEMO_WORKSPACE = "transports-ngwa";
export const PASSENGER_WORKSPACE = "littoral-voyages";

export interface DemoAccount {
  workspace: string;
  username: string;
  pin: string;
  role: string;
  displayName: string;
  aliases: readonly string[];
  branches: "ALL" | readonly string[];
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { workspace: DEMO_WORKSPACE, username: "emilienne", pin: "111111", role: "DIRECTOR", displayName: "Émilienne", aliases: ["director", "direction"], branches: "ALL" },
  { workspace: DEMO_WORKSPACE, username: "boris", pin: "222222", role: "ADMIN", displayName: "Boris", aliases: ["admin", "manager", "ops"], branches: "ALL" },
  { workspace: DEMO_WORKSPACE, username: "sali", pin: "333333", role: "DRIVER", displayName: "Sali", aliases: ["driver", "chauffeur", "field"], branches: "ALL" },
  { workspace: DEMO_WORKSPACE, username: "patrice", pin: "444444", role: "DRIVER", displayName: "Patrice", aliases: ["driver-yde", "field-yde"], branches: ["YDE"] },
  { workspace: DEMO_WORKSPACE, username: "amadou", pin: "555555", role: "ADMIN", displayName: "Amadou Bello", aliases: ["admin-yde"], branches: ["YDE"] },
  { workspace: DEMO_WORKSPACE, username: "herve", pin: "666666", role: "TECHNICIAN", displayName: "Hervé Mbarga", aliases: ["technician", "technicien", "mechanic"], branches: "ALL" },
  { workspace: DEMO_WORKSPACE, username: "nadege", pin: "777777", role: "FINANCE", displayName: "Nadège Fotso", aliases: ["finance", "approver"], branches: "ALL" },
  { workspace: DEMO_WORKSPACE, username: "clarisse", pin: "888888", role: "CASHIER", displayName: "Clarisse Ewane", aliases: ["cashier", "caissier"], branches: ["DLA"] },
  { workspace: PASSENGER_WORKSPACE, username: "josiane", pin: "101010", role: "DIRECTOR", displayName: "Josiane Ndongo", aliases: ["passenger-director"], branches: "ALL" },
  { workspace: PASSENGER_WORKSPACE, username: "paul", pin: "202020", role: "ADMIN", displayName: "Paul Essomba", aliases: ["passenger-admin"], branches: "ALL" },
  { workspace: PASSENGER_WORKSPACE, username: "eric", pin: "303030", role: "DRIVER", displayName: "Éric Tchoua", aliases: ["passenger-driver"], branches: "ALL" },
  { workspace: PASSENGER_WORKSPACE, username: "aline", pin: "404040", role: "FINANCE", displayName: "Aline Mbappe", aliases: ["passenger-finance"], branches: "ALL" },
  { workspace: PASSENGER_WORKSPACE, username: "bertrand", pin: "505050", role: "TECHNICIAN", displayName: "Bertrand Nkeng", aliases: ["passenger-technician"], branches: "ALL" },
  { workspace: PASSENGER_WORKSPACE, username: "grace", pin: "606060", role: "CASHIER", displayName: "Grace Ebode", aliases: ["passenger-cashier"], branches: ["DLA"] },
];

/** The trucking workspace's accounts: what the flows that sweep every account sign in as. */
export const TRUCKING_ACCOUNTS = DEMO_ACCOUNTS.filter((account) => account.workspace === DEMO_WORKSPACE);

/**
 * Accepts a username, a role code (first account with it, so a trucking one),
 * or an alias, case-insensitively. `passenger-<role>` reaches littoral-voyages.
 */
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
