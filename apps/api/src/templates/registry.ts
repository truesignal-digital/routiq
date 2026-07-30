import { TEMPLATE_CODES, type TemplateCode } from "@routiq/contracts";
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

interface TemplateRow {
  presetCode: TemplateCode;
  enabled: boolean;
}

/**
 * The whole rule, in one place. Both the per-command check and the set the API
 * hands the client go through it, so the grandfather clause cannot come to mean
 * two different things in two callers.
 *
 * Presets invert the module default deliberately: modules are on until someone
 * disables them, presets are off until someone enables them (ADR-0004). A
 * preset set is chosen at provisioning, and showing a trucking tenant the
 * passenger vocabulary is the exact failure the ADR set out to fix.
 *
 * Grandfather clause: a workspace with ZERO rows predates `provision-workspace`
 * — both pilot tenants and every existing test seed — and every preset is on.
 * That is what let enforcement ship without a data migration. It is a
 * transition state, not a permanent tier: once the pilot workspaces have
 * `workspace_templates` rows, UNCONFIGURED can be deleted and absent-means-
 * disabled becomes the only rule.
 */
function enablementOf(rows: TemplateRow[], presetCode: TemplateCode): PresetEnablement {
  if (rows.length === 0) return "UNCONFIGURED";
  const row = rows.find((candidate) => candidate.presetCode === presetCode);
  return row?.enabled === true ? "ENABLED" : "DISABLED";
}

// One read, not two: "is this preset on" and "has this workspace been
// configured at all" are the same question asked of the same rows.
function readTemplateRows(tx: Tx, workspaceId: string): Promise<TemplateRow[]> {
  return tx
    .select({
      presetCode: workspaceTemplates.presetCode,
      enabled: workspaceTemplates.enabled,
    })
    .from(workspaceTemplates)
    .where(eq(workspaceTemplates.workspaceId, workspaceId));
}

/** Per-workspace template-preset entitlement (ADR-0004). Mirrors `isModuleEnabled`. */
export async function presetEnablement(
  tx: Tx,
  workspaceId: string,
  presetCode: TemplateCode,
): Promise<PresetEnablement> {
  return enablementOf(await readTemplateRows(tx, workspaceId), presetCode);
}

/**
 * The workspace's enabled set, for clients that shape their UI around it
 * (`GET /v1/me`). Returned in TEMPLATE_CODES order so the client can rely on it
 * being stable rather than on row insertion order.
 */
export async function enabledPresets(tx: Tx, workspaceId: string): Promise<TemplateCode[]> {
  const rows = await readTemplateRows(tx, workspaceId);
  return TEMPLATE_CODES.filter((code) => enablementOf(rows, code) !== "DISABLED");
}
