import {
  disableModulePayload,
  enableModulePayload,
  moduleToggleV2Payload,
  type ModuleToggleV2Payload,
} from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { workspaceModules } from "../db/schema.js";
import { appendPlatformAuditEvent, registerPlatformCommand } from "./dispatcher.js";
import { requiresWorkspaceTarget, workspaceBySlug } from "./platform-target.js";

const FULL_FIELDS = [
  "id",
  "workspaceId",
  "moduleCode",
  "enabled",
  "updatedByCommandId",
  "updatedAt",
  "rowVersion",
];

/**
 * Module flags are entitlements the vendor grants (ADR-0005): only a vendor
 * operator changes them, through the platform pipeline, naming the workspace.
 * The receipt and the audit event carry `scope = 'PLATFORM'` and the tenant's
 * workspace id, so the change is on the platform trail and in the tenant's own
 * history. Turning a module off only hides it: every record it holds stays.
 */
function moduleToggleCommand(name: string, enabled: boolean, eventType: string): void {
  registerPlatformCommand<ModuleToggleV2Payload>({
    scope: "platform",
    name,
    version: 2,
    payloadSchema: moduleToggleV2Payload,
    resolveWorkspace: (tx, _ctx, _envelope, payload) => workspaceBySlug(tx, payload.workspaceSlug),

    async execute(tx, ctx, envelope, payload, workspaceId) {
      const [existingRow] = await tx
        .select()
        .from(workspaceModules)
        .where(
          and(
            eq(workspaceModules.workspaceId, workspaceId),
            eq(workspaceModules.moduleCode, payload.moduleCode),
          ),
        )
        .limit(1);

      const patch = {
        enabled,
        updatedByCommandId: envelope.commandId,
        updatedAt: new Date(),
        rowVersion: existingRow ? existingRow.rowVersion + 1 : 1,
      };

      const [row] = existingRow
        ? await tx
            .update(workspaceModules)
            .set(patch)
            .where(eq(workspaceModules.id, existingRow.id))
            .returning()
        : await tx
            .insert(workspaceModules)
            .values({ workspaceId, moduleCode: payload.moduleCode, ...patch })
            .returning();
      if (!row) throw new Error("workspace_modules write returned no row");

      await appendPlatformAuditEvent(tx, ctx, workspaceId, envelope, {
        eventType,
        entityType: "workspace_module",
        entityId: row.id,
        ...(existingRow ? { beforeState: moduleState(existingRow) } : {}),
        afterState: moduleState(row),
        changedFields: existingRow
          ? ["enabled", "updatedByCommandId", "rowVersion", "updatedAt"]
          : FULL_FIELDS,
      });

      return { recordId: row.id, rowVersion: patch.rowVersion };
    },
  });
}

moduleToggleCommand("enable-module", true, "module.enabled");
moduleToggleCommand("disable-module", false, "module.disabled");

for (const [name, payloadSchema] of [
  ["enable-module", enableModulePayload],
  ["disable-module", disableModulePayload],
] as const) {
  registerPlatformCommand({
    scope: "platform",
    name,
    version: 1,
    payloadSchema,
    resolveWorkspace: requiresWorkspaceTarget,
    execute: requiresWorkspaceTarget,
  });
}

function moduleState(row: typeof workspaceModules.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    moduleCode: row.moduleCode,
    enabled: row.enabled,
    updatedByCommandId: row.updatedByCommandId,
    updatedAt: row.updatedAt.toISOString(),
    rowVersion: row.rowVersion,
  };
}
