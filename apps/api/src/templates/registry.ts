import type { TemplateCode } from "@routiq/contracts";
import { eq } from "drizzle-orm";
import { workspaceTemplates } from "../db/schema.js";
import type { Tx } from "../commands/dispatcher.js";

/**
 * UNCONFIGURED is the grandfather case below, not a third business state. It is
 * a distinct value rather than a boolean so the dispatcher can log which
 * workspaces still need backfilling instead of silently treating them as
 * configured.
 */
export type PresetEnablement = "ENABLED" | "DISABLED" | "UNCONFIGURED";

/**
 * Per-workspace template-preset entitlement (ADR-0004). Mirrors
 * `isModuleEnabled`, and inverts its default deliberately: modules are on until
 * someone disables them, presets are off until someone enables them. A preset
 * set is chosen at provisioning, and showing a trucking tenant the passenger
 * vocabulary is the exact failure ADR-0004 set out to fix.
 *
 * Grandfather rule: a workspace with ZERO rows predates `provision-workspace` —
 * both pilot tenants and every existing test seed — and is treated as
 * all-enabled. That is what lets enforcement ship without a data migration. It
 * is a transition state, not a permanent tier: once the pilot workspaces have
 * `workspace_templates` rows, UNCONFIGURED can be deleted and absent-means-
 * disabled becomes the only rule.
 */
export async function presetEnablement(
  tx: Tx,
  workspaceId: string,
  presetCode: TemplateCode,
): Promise<PresetEnablement> {
  // One read, not two: "is this preset on" and "has this workspace been
  // configured at all" are the same question asked of the same rows.
  const rows = await tx
    .select({
      presetCode: workspaceTemplates.presetCode,
      enabled: workspaceTemplates.enabled,
    })
    .from(workspaceTemplates)
    .where(eq(workspaceTemplates.workspaceId, workspaceId));

  if (rows.length === 0) return "UNCONFIGURED";
  const row = rows.find((candidate) => candidate.presetCode === presetCode);
  return row?.enabled === true ? "ENABLED" : "DISABLED";
}
