import {
  setTemplatePresetPayload,
  TEMPLATE_CODES,
  type SetTemplatePresetPayload,
  type TemplateCode,
} from "@routiq/contracts";
import { eq } from "drizzle-orm";
import { workspaceTemplates } from "../db/schema.js";
import {
  appendAuditEvent,
  CommandError,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";

type TemplateRow = typeof workspaceTemplates.$inferSelect;

const FULL_FIELDS = [
  "id",
  "workspaceId",
  "presetCode",
  "enabled",
  "updatedByCommandId",
  "rowVersion",
];

function templateState(row: TemplateRow): Record<string, unknown> {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    presetCode: row.presetCode,
    enabled: row.enabled,
    updatedByCommandId: row.updatedByCommandId,
    rowVersion: row.rowVersion,
  };
}

/**
 * The writer `workspace_templates` never had: provisioning seeds the rows for a
 * new tenant, and until now nothing could change them afterwards. Mirrors
 * `enable-module`/`disable-module`, with two rules modules do not need.
 */
const setTemplatePreset: CommandDefinition<SetTemplatePresetPayload> = {
  name: "set-template-preset",
  version: 1,
  module: "CORE",
  allowedRoles: ["ADMIN"],
  payloadSchema: setTemplatePresetPayload,
  branchAuthorization: { kind: "workspace" },

  async execute(tx, ctx, envelope, payload) {
    const rows = await tx
      .select()
      .from(workspaceTemplates)
      .where(eq(workspaceTemplates.workspaceId, ctx.workspaceId));

    /**
     * Grandfather clause (templates/registry.ts): a workspace with zero rows
     * predates preset enforcement and has every preset on. Writing only the
     * requested row would end grandfathering and silently disable every preset
     * this call never mentioned, so the first write materializes the whole set —
     * the target as asked, the others explicitly enabled, which is exactly what
     * they were a moment earlier.
     */
    const grandfathered = rows.length === 0;
    const byCode = new Map(rows.map((row) => [row.presetCode, row]));
    const enabledNow = (code: TemplateCode): boolean =>
      grandfathered ? true : (byCode.get(code)?.enabled ?? false);

    // A grandfathered workspace is never a no-op: the row set itself changes.
    if (!grandfathered && enabledNow(payload.presetCode) === payload.enabled) {
      throw new CommandError(409, "PRESET_ALREADY_SET", {
        presetCode: payload.presetCode,
        enabled: payload.enabled,
      });
    }

    // Computed against the post-materialization picture, so the transition
    // cannot be the thing that empties the set.
    const stillEnabled = TEMPLATE_CODES.filter((code) =>
      code === payload.presetCode ? payload.enabled : enabledNow(code),
    );
    if (stillEnabled.length === 0) {
      throw new CommandError(409, "LAST_PRESET", { presetCode: payload.presetCode });
    }

    const existing = byCode.get(payload.presetCode);
    const patch = {
      enabled: payload.enabled,
      updatedByCommandId: envelope.commandId,
      rowVersion: existing ? existing.rowVersion + 1 : 1,
    };

    const [target] = existing
      ? await tx
          .update(workspaceTemplates)
          .set(patch)
          .where(eq(workspaceTemplates.id, existing.id))
          .returning()
      : await tx
          .insert(workspaceTemplates)
          .values({
            workspaceId: ctx.workspaceId,
            presetCode: payload.presetCode,
            ...patch,
          })
          .returning();
    if (!target) throw new Error("workspace_templates write returned no row");

    if (grandfathered) {
      const others = TEMPLATE_CODES.filter((code) => code !== payload.presetCode);
      if (others.length > 0) {
        const materialized = await tx
          .insert(workspaceTemplates)
          .values(
            others.map((presetCode) => ({
              workspaceId: ctx.workspaceId,
              presetCode,
              enabled: true,
              updatedByCommandId: envelope.commandId,
            })),
          )
          .returning();
        for (const row of materialized) {
          await appendAuditEvent(tx, ctx, envelope, {
            eventType: "template_preset.materialized",
            entityType: "workspace_template",
            entityId: row.id,
            afterState: templateState(row),
            changedFields: FULL_FIELDS,
          });
        }
      }
    }

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: payload.enabled ? "template_preset.enabled" : "template_preset.disabled",
      entityType: "workspace_template",
      entityId: target.id,
      ...(existing ? { beforeState: templateState(existing) } : {}),
      afterState: templateState(target),
      changedFields: existing ? ["enabled", "updatedByCommandId", "rowVersion"] : FULL_FIELDS,
    });

    return { recordId: target.id, rowVersion: target.rowVersion };
  },
};

registerCommand(setTemplatePreset);
