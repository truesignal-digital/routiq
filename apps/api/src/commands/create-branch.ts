import { createBranchPayload, type CreateBranchPayload } from "@routiq/contracts";
import { branches } from "../db/schema.js";
import {
  appendAuditEvent,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";

const createBranch: CommandDefinition<CreateBranchPayload> = {
  name: "create-branch",
  version: 1,
  module: "CORE",
  allowedRoles: ["ADMIN"],
  payloadSchema: createBranchPayload,
  branchAuthorization: { kind: "workspace" },

  async execute(tx, ctx, envelope, payload) {
    const [row] = await tx
      .insert(branches)
      .values({
        id: payload.branchId,
        workspaceId: ctx.workspaceId,
        code: payload.code,
        name: payload.name,
        ...(payload.timezone === undefined ? {} : { timezone: payload.timezone }),
        createdByCommandId: envelope.commandId,
      })
      .returning();
    if (!row) throw new Error("branches insert returned no row");

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "branch.created",
      entityType: "branch",
      entityId: row.id,
      afterState: {
        id: row.id,
        workspaceId: row.workspaceId,
        code: row.code,
        name: row.name,
        timezone: row.timezone,
        active: row.active,
        createdByCommandId: row.createdByCommandId,
        rowVersion: row.rowVersion,
      },
      changedFields: [
        "id",
        "workspaceId",
        "code",
        "name",
        "timezone",
        "active",
        "createdByCommandId",
        "rowVersion",
      ],
    });

    return { recordId: row.id, rowVersion: row.rowVersion };
  },
};

registerCommand(createBranch);
