import { isModuleOn, type ModuleCode } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { workspaceModules } from "../db/schema.js";
import type { Tx } from "../commands/dispatcher.js";

/**
 * Per-workspace module entitlement (§3.3a). Command ownership is declared on
 * each CommandDefinition's `module` field — there is no separate list to sync.
 * Absent row = the module's default: on, except the few in
 * MODULES_OFF_BY_DEFAULT, which the vendor turns on. CORE is never disableable.
 */
export async function isModuleEnabled(
  tx: Tx,
  workspaceId: string,
  moduleCode: ModuleCode,
): Promise<boolean> {
  if (moduleCode === "CORE") return true;
  const [row] = await tx
    .select({ enabled: workspaceModules.enabled })
    .from(workspaceModules)
    .where(
      and(
        eq(workspaceModules.workspaceId, workspaceId),
        eq(workspaceModules.moduleCode, moduleCode),
      ),
    )
    .limit(1);
  return isModuleOn(moduleCode, row);
}
