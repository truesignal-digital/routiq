import type { PrincipalType, Role } from "@routiq/contracts";
import { randomUUID } from "node:crypto";
import { hashPin } from "../auth/pin.js";
import { branches, categories, credentials, memberships, principals, workspaces, approvalRules } from "../db/schema.js";
import type { Db } from "../db/client.js";
import { defaultApprovalRules } from "../commands/approval-defaults.js";
import { presetCategories } from "../commands/category-presets.js";

export async function seedWorkspace(db: Db, slug = `ws-${randomUUID().slice(0, 8)}`) {
  const [workspace] = await db
    .insert(workspaces)
    .values({ slug, name: slug })
    .returning();
  if (!workspace) throw new Error("workspace insert returned no row");
  const [branch] = await db
    .insert(branches)
    .values({ workspaceId: workspace.id, code: "DLA", name: "Douala" })
    .returning();
  if (!branch) throw new Error("branch insert returned no row");

  // Insert preset categories for this workspace
  const categoryPresets = presetCategories(workspace.id);
  if (categoryPresets.length > 0) {
    await db.insert(categories).values(categoryPresets);
  }

  // Insert default approval rules for this workspace
  await db.insert(approvalRules).values(defaultApprovalRules(workspace.id));

  return { workspace, branch };
}

export async function seedMember(
  db: Db,
  opts: {
    workspaceId: string;
    role: Role;
    principalType?: PrincipalType;
    branchIds?: string[];
    allBranches?: boolean;
    username?: string;
    pin?: string;
  },
) {
  const [principal] = await db
    .insert(principals)
    .values({
      principalType: opts.principalType ?? "HUMAN",
      displayName: opts.username ?? `member-${randomUUID().slice(0, 8)}`,
    })
    .returning();
  if (!principal) throw new Error("principal insert returned no row");

  const [membership] = await db
    .insert(memberships)
    .values({
      workspaceId: opts.workspaceId,
      principalId: principal.id,
      role: opts.role,
      allBranches: opts.allBranches ?? false,
      branchIds: opts.branchIds ?? [],
    })
    .returning();
  if (!membership) throw new Error("membership insert returned no row");

  if (opts.username && opts.pin) {
    await db.insert(credentials).values({
      workspaceId: opts.workspaceId,
      principalId: principal.id,
      username: opts.username,
      pinHash: await hashPin(opts.pin),
    });
  }

  return { principal, membership };
}
