import { financialEntryPayload } from "@routiq/contracts";
import type { z } from "zod";
import {
  assetBranchIds,
  branchIdsByCode,
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
}

function financialEntryCommand(
  config: FinancialEntryCommandConfig,
): CommandDefinition<FinancialEntryPayload> {
  return {
    name: config.name,
    version: 1,
    module: "FINANCE",
    allowedRoles: ["FIELD_SUBMITTER", "OPS_MANAGER", "FINANCE_APPROVER", "ADMIN"],
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
  }),
);
registerCommand(
  financialEntryCommand({
    name: "record-revenue",
    direction: "REVENUE",
    categoryKind: "REVENUE_CATEGORY",
    categoryRefType: "revenueCategory",
  }),
);
