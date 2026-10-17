import {
  setTemplatePresetPayload,
  setTemplatePresetV2Payload,
  TEMPLATE_CODES,
  type SetTemplatePresetV2Payload,
  type TemplateCode,
} from "@routiq/contracts";
import { eq } from "drizzle-orm";
import { workspaceTemplates } from "../db/schema.js";
import {
  appendPlatformAuditEvent,
  CommandError,
  registerPlatformCommand,
} from "./dispatcher.js";
import { requiresWorkspaceTarget, workspaceBySlug } from "./platform-target.js";

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
 * new tenant, and nothing else changes them afterwards. Vendor-set like modules
 * (ADR-0005), so it mirrors `enable-module`/`disable-module` at platform scope,
 * with two rules modules do not need.
 */
registerPlatformCommand<SetTemplatePresetV2Payload>({
  scope: "platform",
  name: "set-template-preset",
  version: 2,
  payloadSchema: setTemplatePresetV2Payload,
  resolveWorkspace: (tx, _ctx, _envelope, payload) => workspaceBySlug(tx, payload.workspaceSlug),

  async execute(tx, ctx, envelope, payload, workspaceId) {
    const rows = await tx
      .select()
      .from(workspaceTemplates)
      .where(eq(workspaceTemplates.workspaceId, workspaceId));

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
            workspaceId,
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
              workspaceId,
              presetCode,
              enabled: true,
              updatedByCommandId: envelope.commandId,
            })),
          )
          .returning();
        for (const row of materialized) {
          await appendPlatformAuditEvent(tx, ctx, workspaceId, envelope, {
            eventType: "template_preset.materialized",
            entityType: "workspace_template",
            entityId: row.id,
            afterState: templateState(row),
            changedFields: FULL_FIELDS,
          });
        }
      }
    }

    await appendPlatformAuditEvent(tx, ctx, workspaceId, envelope, {
      eventType: payload.enabled ? "template_preset.enabled" : "template_preset.disabled",
      entityType: "workspace_template",
      entityId: target.id,
      ...(existing ? { beforeState: templateState(existing) } : {}),
      afterState: templateState(target),
      changedFields: existing ? ["enabled", "updatedByCommandId", "rowVersion"] : FULL_FIELDS,
    });

    return { recordId: target.id, rowVersion: target.rowVersion };
  },
});

registerPlatformCommand({
  scope: "platform",
  name: "set-template-preset",
  version: 1,
  payloadSchema: setTemplatePresetPayload,
  resolveWorkspace: requiresWorkspaceTarget,
  execute: requiresWorkspaceTarget,
});
