import { disableModulePayload, enableModulePayload } from "@asset/contracts";
import type { z } from "zod";
import { and, eq } from "drizzle-orm";
import { workspaceModules } from "../db/schema.js";
import { appendAuditEvent, registerCommand, type CommandDefinition } from "./dispatcher.js";

type ModuleTogglePayload = z.infer<typeof enableModulePayload>;

const FULL_FIELDS = [
  "id",
  "workspaceId",
  "moduleCode",
  "enabled",
  "updatedByCommandId",
  "updatedAt",
  "rowVersion",
];

function moduleToggleCommand(opts: {
  name: string;
  enabled: boolean;
  eventType: string;
  payloadSchema: typeof enableModulePayload;
}): CommandDefinition<ModuleTogglePayload> {
  return {
    name: opts.name,
    version: 1,
    allowedRoles: ["ADMIN"],
    payloadSchema: opts.payloadSchema,
    async execute(tx, ctx, envelope, payload) {
      const [existingRow] = await tx
        .select()
        .from(workspaceModules)
        .where(
          and(
            eq(workspaceModules.workspaceId, ctx.workspaceId),
            eq(workspaceModules.moduleCode, payload.moduleCode),
          ),
        )
        .limit(1);

      const patch = {
        enabled: opts.enabled,
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
            .values({ workspaceId: ctx.workspaceId, moduleCode: payload.moduleCode, ...patch })
            .returning();
      if (!row) throw new Error("workspace_modules write returned no row");

      await appendAuditEvent(tx, ctx, envelope, {
        eventType: opts.eventType,
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
  };
}

registerCommand(
  moduleToggleCommand({
    name: "enable-module",
    enabled: true,
    eventType: "module.enabled",
    payloadSchema: enableModulePayload,
  }),
);
registerCommand(
  moduleToggleCommand({
    name: "disable-module",
    enabled: false,
    eventType: "module.disabled",
    payloadSchema: disableModulePayload,
  }),
);

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
