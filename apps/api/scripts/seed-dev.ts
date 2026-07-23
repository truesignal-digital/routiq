// Dev seed: demo workspace sotrafret with user amina / PIN 246810. Local dev only.
import "dotenv/config";
import { hashPin } from "../src/auth/pin.js";
import { db, pool } from "../src/db/client.js";
import { approvalRules, branches, categories, credentials, memberships, principals, workspaces } from "../src/db/schema.js";
import { defaultApprovalRules } from "../src/commands/approval-defaults.js";
import { presetCategories } from "../src/commands/category-presets.js";

const [ws] = await db
  .insert(workspaces)
  .values({ slug: "sotrafret", name: "SotraFret Douala" })
  .onConflictDoNothing()
  .returning();
const workspace = ws ?? (await db.select().from(workspaces)).find((w) => w.slug === "sotrafret");
if (!workspace) throw new Error("workspace seed failed");

await db
  .insert(branches)
  .values({ workspaceId: workspace.id, code: "DLA", name: "Douala" })
  .onConflictDoNothing();

const [principal] = await db
  .insert(principals)
  .values({ principalType: "HUMAN", displayName: "Amina Njoya" })
  .returning();
if (!principal) throw new Error("principal seed failed");

await db.insert(memberships).values({
  workspaceId: workspace.id,
  principalId: principal.id,
  role: "ADMIN",
  allBranches: true,
});

await db.insert(credentials).values({
  workspaceId: workspace.id,
  principalId: principal.id,
  username: "amina",
  pinHash: await hashPin("246810"),
});

await db.insert(approvalRules).values(defaultApprovalRules(workspace.id)).onConflictDoNothing();
await db.insert(categories).values(presetCategories(workspace.id)).onConflictDoNothing();

console.log("seeded: workspace=sotrafret username=amina pin=246810 (+approval rules, categories)");
await pool.end();
