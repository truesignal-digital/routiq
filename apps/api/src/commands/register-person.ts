import { registerPersonPayload } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { branches, persons } from "../db/schema.js";
import { branchIdsByCode } from "./branch-authorization.js";
import {
  appendAuditEvent,
  CommandError,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";

type RegisterPersonPayload = z.infer<typeof registerPersonPayload>;

const registerPerson: CommandDefinition<RegisterPersonPayload> = {
  name: "register-person",
  version: 1,
  module: "ACTIVITIES",
  allowedRoles: ["ADMIN", "OPS_MANAGER"],
  payloadSchema: registerPersonPayload,
  branchAuthorization: {
    kind: "branches",
    resolve: (tx, ctx, payload) => branchIdsByCode(tx, ctx, [payload.branchCode]),
  },

  async approvalContext(_tx, _ctx, payload) {
    return { branchCode: payload.branchCode };
  },

  async execute(tx, ctx, envelope, payload) {
    const [branch] = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(eq(branches.workspaceId, ctx.workspaceId), eq(branches.code, payload.branchCode)),
      )
      .limit(1);
    if (!branch) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "branch",
        referenceCode: payload.branchCode,
      });
    }

    await tx.insert(persons).values({
      id: payload.personId,
      workspaceId: ctx.workspaceId,
      branchId: branch.id,
      displayName: payload.displayName,
      ...(payload.personCode === undefined ? {} : { personCode: payload.personCode }),
      ...(payload.phone === undefined ? {} : { phone: payload.phone }),
      ...(payload.defaultRole === undefined ? {} : { defaultRole: payload.defaultRole }),
      createdByCommandId: envelope.commandId,
    });

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "person.registered",
      entityType: "person",
      entityId: payload.personId,
      afterState: {
        id: payload.personId,
        workspaceId: ctx.workspaceId,
        branchId: branch.id,
        displayName: payload.displayName,
        personCode: payload.personCode ?? null,
        phone: payload.phone ?? null,
        defaultRole: payload.defaultRole ?? null,
        membershipId: null,
        active: true,
        rowVersion: 1,
      },
      changedFields: [
        "id",
        "workspaceId",
        "branchId",
        "displayName",
        "personCode",
        "phone",
        "defaultRole",
        "membershipId",
        "active",
        "rowVersion",
      ],
    });

    return { recordId: payload.personId, rowVersion: 1 };
  },
};

registerCommand(registerPerson);
