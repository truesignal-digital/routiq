import {
  financialEntryPayload,
  type CommandWarningCode,
} from "@routiq/contracts";
import { and, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import {
  assets,
  branches,
  categories,
  financialEntries,
  financialPostings,
} from "../db/schema.js";
import {
  assetBranchIds,
  branchIdsByCode,
} from "./branch-authorization.js";
import {
  appendAuditEvent,
  CommandError,
  registerCommand,
  type CommandDefinition,
} from "./dispatcher.js";
import { nextEntryNumber } from "./numbering.js";
import { resolvePostingPeriod } from "./periods.js";

type FinancialEntryPayload = z.infer<typeof financialEntryPayload>;

interface FinancialEntryCommandConfig {
  name: string;
  direction: "EXPENSE" | "REVENUE";
  categoryKind: "EXPENSE_CATEGORY" | "REVENUE_CATEGORY";
  categoryRefType: "expenseCategory" | "revenueCategory";
}

const TERMINAL_ASSET_STATUSES = new Set(["SOLD", "RETIRED", "WRITTEN_OFF"]);

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
      const postingTotal = payload.postings.reduce(
        (sum, posting) => sum + BigInt(posting.amountMinor),
        0n,
      );
      if (postingTotal !== BigInt(payload.amountMinor)) {
        throw new CommandError(422, "POSTINGS_SUM_MISMATCH", {
          entryAmountMinor: payload.amountMinor,
          postingsAmountMinor: Number(postingTotal),
        });
      }

      const [branch] = await tx
        .select({ id: branches.id, code: branches.code })
        .from(branches)
        .where(
          and(
            eq(branches.workspaceId, ctx.workspaceId),
            eq(branches.code, payload.branchCode),
          ),
        )
        .limit(1);
      if (!branch) {
        throw new CommandError(422, "REFERENCE_NOT_FOUND", {
          referenceType: "branch",
          referenceCode: payload.branchCode,
        });
      }
      const categoryMatches = await tx
        .select({
          id: categories.id,
          kind: categories.kind,
          evidencePolicy: categories.evidencePolicy,
        })
        .from(categories)
        .where(
          and(
            eq(categories.workspaceId, ctx.workspaceId),
            eq(categories.code, payload.categoryCode),
            eq(categories.active, true),
          ),
        );
      const category = categoryMatches.find(
        (candidate) => candidate.kind === config.categoryKind,
      );
      if (!category) {
        if (categoryMatches.length > 0) {
          throw new CommandError(422, "CATEGORY_KIND_MISMATCH", {
            categoryCode: payload.categoryCode,
            expectedKind: config.categoryKind,
          });
        }
        throw new CommandError(422, "REFERENCE_NOT_FOUND", {
          referenceType: config.categoryRefType,
          referenceCode: payload.categoryCode,
        });
      }

      const requestedAssetIds = [
        ...new Set(
          payload.postings.flatMap((posting) =>
            posting.assetId === undefined ? [] : [posting.assetId],
          ),
        ),
      ];
      if (requestedAssetIds.length > 0) {
        const assetRows = await tx
          .select({
            id: assets.id,
            branchId: assets.branchId,
            lifecycleStatus: assets.lifecycleStatus,
          })
          .from(assets)
          .where(
            and(
              eq(assets.workspaceId, ctx.workspaceId),
              inArray(assets.id, requestedAssetIds),
            ),
          );
        const assetsById = new Map(assetRows.map((asset) => [asset.id, asset]));
        const missing = requestedAssetIds.filter(
          (assetId) => !assetsById.has(assetId),
        );
        if (missing.length > 0) {
          throw new CommandError(422, "REFERENCE_NOT_FOUND", {
            referenceType: "asset",
            missing,
          });
        }
        const terminal = assetRows.find((asset) =>
          TERMINAL_ASSET_STATUSES.has(asset.lifecycleStatus),
        );
        if (terminal) {
          throw new CommandError(409, "ASSET_NOT_OPERATIONAL", {
            assetId: terminal.id,
            lifecycleStatus: terminal.lifecycleStatus,
          });
        }
      }

      const entryNumber = await nextEntryNumber(
        tx,
        ctx,
        branch,
        payload.economicDate,
      );
      const isPosted = approval.outcome === "AUTO_APPROVED";
      const period = isPosted
        ? await resolvePostingPeriod(
            tx,
            ctx,
            payload.economicDate,
            envelope.commandId,
          )
        : undefined;
      const warnings: CommandWarningCode[] = [];
      const hasVerifiablePaymentReference =
        payload.paymentReference !== undefined &&
        ["MOMO", "OM", "BANK"].includes(payload.paymentMethod);
      if (
        category.evidencePolicy === "RECEIPT_EXPECTED" &&
        envelope.sourceArtifactIds.length === 0 &&
        !hasVerifiablePaymentReference
      ) {
        warnings.push("EVIDENCE_MISSING");
      }
      if (period?.isLatePosting === true) warnings.push("LATE_POSTING");

      const status = isPosted ? "POSTED" : "SUBMITTED";
      const createdAt = new Date();
      const postedAt = isPosted ? createdAt : undefined;
      await tx.insert(financialEntries).values({
        id: payload.entryId,
        workspaceId: ctx.workspaceId,
        entryNumber,
        direction: config.direction,
        categoryId: category.id,
        economicDate: payload.economicDate,
        postingPeriodId: period?.periodId ?? null,
        isLatePosting: period?.isLatePosting ?? false,
        branchId: branch.id,
        ...(payload.counterpartyName === undefined
          ? {}
          : { counterpartyName: payload.counterpartyName }),
        ...(payload.description === undefined
          ? {}
          : { description: payload.description }),
        amountMinor: BigInt(payload.amountMinor),
        currency: payload.currency,
        paymentMethod: payload.paymentMethod,
        ...(payload.paymentReference === undefined
          ? {}
          : { paymentReference: payload.paymentReference }),
        ...(payload.sourceReference === undefined
          ? {}
          : { sourceReference: payload.sourceReference }),
        estimateStatus: payload.estimateStatus,
        status,
        ...(postedAt === undefined ? {} : { postedAt }),
        createdByCommandId: envelope.commandId,
        createdAt,
      });

      const postingRows = payload.postings.map((posting, index) => ({
        id: crypto.randomUUID(),
        workspaceId: ctx.workspaceId,
        financialEntryId: payload.entryId,
        lineNo: index + 1,
        economicDate: payload.economicDate,
        postingPeriodId: period?.periodId ?? null,
        direction: config.direction,
        categoryId: category.id,
        branchId: branch.id,
        ...(posting.assetId === undefined ? {} : { assetId: posting.assetId }),
        amountMinor: BigInt(posting.amountMinor),
        assetAttribution: posting.assetAttribution,
        createdByCommandId: envelope.commandId,
        createdAt,
      }));
      await tx.insert(financialPostings).values(postingRows);

      await appendAuditEvent(tx, ctx, envelope, {
        eventType: isPosted
          ? "financial_entry.posted"
          : "financial_entry.submitted",
        entityType: "financial_entry",
        entityId: payload.entryId,
        afterState: {
          id: payload.entryId,
          workspaceId: ctx.workspaceId,
          entryNumber,
          direction: config.direction,
          categoryId: category.id,
          economicDate: payload.economicDate,
          postingPeriodId: period?.periodId ?? null,
          isLatePosting: period?.isLatePosting ?? false,
          branchId: branch.id,
          counterpartyName: payload.counterpartyName ?? null,
          description: payload.description ?? null,
          amountMinor: payload.amountMinor,
          currency: payload.currency,
          paymentMethod: payload.paymentMethod,
          paymentReference: payload.paymentReference ?? null,
          sourceReference: payload.sourceReference ?? null,
          estimateStatus: payload.estimateStatus,
          status,
          rejectedReason: null,
          reversesEntryId: null,
          postedAt: postedAt?.toISOString() ?? null,
          rowVersion: 1,
          createdByCommandId: envelope.commandId,
          createdAt: createdAt.toISOString(),
          postings: postingRows.map((posting) => ({
            ...posting,
            assetId: posting.assetId ?? null,
            amountMinor: Number(posting.amountMinor),
            createdAt: posting.createdAt.toISOString(),
          })),
        },
        changedFields: [
          "id",
          "workspaceId",
          "entryNumber",
          "direction",
          "categoryId",
          "economicDate",
          "postingPeriodId",
          "isLatePosting",
          "branchId",
          "counterpartyName",
          "description",
          "amountMinor",
          "currency",
          "paymentMethod",
          "paymentReference",
          "sourceReference",
          "estimateStatus",
          "status",
          "rejectedReason",
          "reversesEntryId",
          "postedAt",
          "rowVersion",
          "createdByCommandId",
          "createdAt",
          "postings",
        ],
      });

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
