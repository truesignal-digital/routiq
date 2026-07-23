import type { ModuleCode } from "@asset/contracts";
import { and, eq } from "drizzle-orm";
import { workspaceModules } from "../db/schema.js";
import type { Tx } from "../commands/dispatcher.js";

/**
 * Fixed code-level module registry (§3.3a): each module declares the commands it owns.
 * CORE commands are never disableable and skip the entitlement check.
 */
const MODULE_COMMANDS: Record<ModuleCode, readonly string[]> = {
  CORE: ["enable-module", "disable-module"],
  ASSETS: ["register-asset", "commission-asset", "assign-asset"],
  DOCUMENTS: ["add-or-renew-document"],
};

export function moduleOwningCommand(commandName: string): ModuleCode | undefined {
  for (const [module, commandNames] of Object.entries(MODULE_COMMANDS)) {
    if (commandNames.includes(commandName)) return module as ModuleCode;
  }
  return undefined;
}

/** Absent row = enabled: modules are on by default and disabling is the recorded act. */
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
  return row?.enabled ?? true;
}
