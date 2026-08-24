import { financialEntryPayload } from "@routiq/contracts";
import type { z } from "zod";
import {
  assetBranchIds,
  branchIdsByCode,
  workOrderBranchIds,
} from "./branch-authorization.js";
import { registerCommand, type CommandDefinition } from "./dispatcher.js";
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
  allowedRoles: CommandDefinition<FinancialEntryPayload>["allowedRoles"];
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
        // A WO posting may omit its asset (the writer fills it in), so the
        // scope check has to reach the work order's branch directly.
        const postingWorkOrderIds = payload.postings.flatMap((posting) =>
          posting.workOrderId === undefined ? [] : [posting.workOrderId],
        );
        // A transaction owns one pg connection — child reads stay sequential.
        const entryBranchIds = await branchIdsByCode(tx, ctx, [payload.branchCode]);
        const postingBranchIds = await assetBranchIds(tx, ctx, postingAssetIds);
        const postingWorkOrderBranchIds = await workOrderBranchIds(
          tx,
          ctx,
          postingWorkOrderIds,
        );
        return [
          ...new Set([
            ...entryBranchIds,
            ...postingBranchIds,
            ...postingWorkOrderBranchIds,
          ]),
        ];
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
    // MAINTENANCE records the parts and labor of its own work orders (§4.2
    // "costs via ordinary expenses") — the seeded band keeps it auto only up
    // to the same threshold as every other recording role.
    allowedRoles: [
      "FIELD_SUBMITTER",
      "MAINTENANCE",
      "OPS_MANAGER",
      "FINANCE_APPROVER",
      "ADMIN",
    ],
  }),
);
registerCommand(
  financialEntryCommand({
    name: "record-revenue",
    direction: "REVENUE",
    categoryKind: "REVENUE_CATEGORY",
    categoryRefType: "revenueCategory",
    allowedRoles: ["FIELD_SUBMITTER", "OPS_MANAGER", "FINANCE_APPROVER", "ADMIN"],
  }),
);
