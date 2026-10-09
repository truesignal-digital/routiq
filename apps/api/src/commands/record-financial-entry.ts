import { financialEntryPayload } from "@routiq/contracts";
import type { z } from "zod";
import {
  assetBranchIds,
  branchIdsByCode,
} from "./branch-authorization.js";
import { canBookWorkOrderCost, type Role } from "@routiq/contracts";
import {
  CommandError,
  registerCommand,
  resolveCommand,
  type CommandDefinition,
} from "./dispatcher.js";
import {
  writeFinancialEntry,
  type FinancialEntryWriteRequest,
} from "./financial-entry-writer.js";

type FinancialEntryPayload = z.infer<typeof financialEntryPayload>;

interface FinancialEntryCommandConfig {
  name: string;
  direction: FinancialEntryWriteRequest["direction"];
  categoryKind: FinancialEntryWriteRequest["categoryKind"];
  categoryRefType: FinancialEntryWriteRequest["categoryRefType"];
  allowedRoles: readonly Role[];
}

/**
 * The workshop records what a repair cost, and nothing else: a TECHNICIAN
 * member's expense is accepted only when every line is attributed to a work
 * order, which the writer then holds to APPROVED status and branch scope.
 * Parts and labour are not the other roles' to book (`canBookWorkOrderCost`),
 * so no line of a DRIVER, FINANCE or CASHIER member may name a work order.
 */
export function requireWorkOrderAttribution(
  role: Role,
  payload: Pick<FinancialEntryPayload, "postings">,
  command: string,
): void {
  if (
    !canBookWorkOrderCost(role) &&
    payload.postings.some((posting) => posting.workOrderId !== undefined)
  ) {
    throw new CommandError(403, "ROLE_FORBIDDEN", {
      command,
      reason: "WORK_ORDER_COST_FORBIDDEN",
    });
  }
  if (role !== "TECHNICIAN") return;
  if (payload.postings.some((posting) => posting.workOrderId === undefined)) {
    throw new CommandError(403, "ROLE_FORBIDDEN", {
      command,
      reason: "WORK_ORDER_REQUIRED",
    });
  }
}

/**
 * A write under record-expense's or record-revenue's rules (a pending-entry
 * edit, each money line of a sheet) passes that command's role gate too, read from its registration so the roles live in one
 * place: a driver records expenses, never revenue (#532), and so may not edit
 * a pending revenue entry either (#572).
 */
export function requireRecordRole(
  role: Role,
  recordCommand: "record-expense" | "record-revenue",
): void {
  const definition = resolveCommand(recordCommand, 1);
  if (!("allowedRoles" in definition) || !definition.allowedRoles.includes(role)) {
    throw new CommandError(403, "ROLE_FORBIDDEN", { command: recordCommand });
  }
}

function financialEntryCommand(
  config: FinancialEntryCommandConfig,
): CommandDefinition<FinancialEntryPayload> {
  return {
    name: config.name,
    version: 1,
    module: "FINANCE",
    allowedRoles: config.allowedRoles,
    payloadSchema: financialEntryPayload,
    approvalMode: "SUBMIT",
    branchAuthorization: {
      kind: "branches",
      async resolve(tx, ctx, payload) {
        const postingAssetIds = payload.postings.flatMap((posting) =>
          posting.assetId === undefined ? [] : [posting.assetId],
        );
        const [entryBranchIds, postingBranchIds] = await Promise.all([
          branchIdsByCode(tx, ctx, [payload.branchCode]),
          assetBranchIds(tx, ctx, postingAssetIds),
        ]);
        return [...new Set([...entryBranchIds, ...postingBranchIds])];
      },
    },

    async approvalContext(_tx, _ctx, payload) {
      return {
        branchCode: payload.branchCode,
        categoryCode: payload.categoryCode,
        amountMinor: payload.amountMinor,
      };
    },

    async execute(tx, ctx, envelope, payload, approval) {
      requireWorkOrderAttribution(ctx.role, payload, config.name);
      const request: FinancialEntryWriteRequest = {
        direction: config.direction,
        categoryKind: config.categoryKind,
        categoryRefType: config.categoryRefType,
        ...payload,
      };
      const { status, warnings } = await writeFinancialEntry(
        tx,
        ctx,
        envelope,
        request,
        approval,
      );

      return {
        recordId: payload.entryId,
        rowVersion: 1,
        recordStatus: status,
        warnings,
      };
    },
  };
}

registerCommand(
  financialEntryCommand({
    name: "record-expense",
    direction: "EXPENSE",
    categoryKind: "EXPENSE_CATEGORY",
    categoryRefType: "expenseCategory",
    allowedRoles: ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"],
  }),
);
registerCommand(
  financialEntryCommand({
    name: "record-revenue",
    direction: "REVENUE",
    categoryKind: "REVENUE_CATEGORY",
    categoryRefType: "revenueCategory",
    allowedRoles: ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER"],
  }),
);
