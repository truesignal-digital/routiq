import type { approvalRules } from "../db/schema.js";
import { corePack } from "../provisioning/packs/core.js";

/**
 * Default approval rules for the spine catalog (§5.1), scoped to a workspace.
 */
export function defaultApprovalRules(
  workspaceId: string,
): Array<typeof approvalRules.$inferInsert> {
  return corePack.approvalRules.map((rule) => ({ ...rule, workspaceId }));
}
