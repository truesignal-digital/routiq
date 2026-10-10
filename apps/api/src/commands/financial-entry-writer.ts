import type { CommandEnvelope, CommandOrigin, CommandWarningCode } from "@routiq/contracts";
import { entryEvidenceState } from "@routiq/domain";
import { and, eq, inArray } from "drizzle-orm";
import {
  activities,
  assets,
  categories,
  financialEntries,
  financialPostings,
  persons,
  workOrders,
} from "../db/schema.js";
import type { ApprovalDecision } from "./approvals.js";
import { resolveTargetBranch } from "./branch-authorization.js";
import {
  appendAuditEvent,
  CommandError,
  type CommandContext,
  type Tx,
} from "./dispatcher.js";
import { nextEntryNumber } from "./numbering.js";
import { assertOwnTrip } from "./own-records.js";
import { resolvePostingPeriod } from "./periods.js";

export interface FinancialEntryPostingWriteRequest {
  assetId?: string | undefined;
  activityId?: string | undefined;
  workOrderId?: string | undefined;
  personId?: string | undefined;
  amountMinor: number;
  assetAttribution: "DIRECT" | "ALLOCATED";
  activityAttribution?: "DIRECT" | "ALLOCATED" | undefined;
}

export interface FinancialEntryWriteRequest {
  entryId: string;
  direction: "EXPENSE" | "REVENUE";
  categoryKind: "EXPENSE_CATEGORY" | "REVENUE_CATEGORY";
  categoryRefType: "expenseCategory" | "revenueCategory";
  branchCode: string;
  categoryCode: string;
  economicDate: string;
  counterpartyName?: string | undefined;
  description?: string | undefined;
  amountMinor: number;
  currency: string;
  paymentMethod: "CASH" | "MOMO" | "OM" | "BANK" | "OTHER";
  paymentReference?: string | undefined;
  sourceReference?: string | undefined;
  estimateStatus: "ACTUAL" | "ESTIMATED";
  postings: FinancialEntryPostingWriteRequest[];
}

export interface FinancialEntryWriteResult {
  entryId: string;
  entryNumber: string;
  status: "POSTED" | "SUBMITTED";
  warnings: CommandWarningCode[];
}

const TERMINAL_ASSET_STATUSES = new Set(["SOLD", "RETIRED", "WRITTEN_OFF"]);

/** What an entry says, apart from where it is booked: the part an edit may change. */
export type FinancialEntryFacts = Omit<FinancialEntryWriteRequest, "entryId" | "branchCode">;

export type EntryCategory = Pick<typeof categories.$inferSelect, "id" | "evidencePolicy">;

/** §3.4: the lines sum exactly to the entry. The database checks it again at commit (0031). */
export function assertPostingsBalance(
  facts: Pick<FinancialEntryFacts, "amountMinor" | "postings">,
): void {
  const postingTotal = facts.postings.reduce(
    (sum, posting) => sum + BigInt(posting.amountMinor),
    0n,
  );
  if (postingTotal !== BigInt(facts.amountMinor)) {
    throw new CommandError(422, "POSTINGS_SUM_MISMATCH", {
      entryAmountMinor: facts.amountMinor,
      postingsAmountMinor: Number(postingTotal),
    });
  }
}

export async function writeFinancialEntry(
  tx: Tx,
  ctx: CommandContext,
  envelope: CommandEnvelope,
  request: FinancialEntryWriteRequest,
  approval: ApprovalDecision,
): Promise<FinancialEntryWriteResult> {
  assertPostingsBalance(request);

  const { branch, warnings: branchWarnings } = await resolveTargetBranch(
    tx,
    ctx,
    envelope,
    request.branchCode,
  );
  const category = await resolveEntryReferences(tx, ctx, request, envelope.origin);

  const entryNumber = await nextEntryNumber(
    tx,
    ctx,
    branch,
    request.economicDate,
  );
  const warnings: CommandWarningCode[] = [...branchWarnings];

  const posting = await resolvePostingOrDefer(tx, ctx, envelope, request.economicDate, approval);
  const { isPosted, period } = posting;
  warnings.push(...posting.warnings);
  if (
    evidenceMissing(category, request, envelope.sourceArtifactIds.length)
  ) {
    warnings.push("EVIDENCE_MISSING");
  }
  if (period?.isLatePosting === true) warnings.push("LATE_POSTING");

  const status = isPosted ? "POSTED" : "SUBMITTED";
  const createdAt = new Date();
  const postedAt = isPosted ? createdAt : undefined;
  await tx.insert(financialEntries).values({
    id: request.entryId,
    workspaceId: ctx.workspaceId,
    entryNumber,
    direction: request.direction,
    categoryId: category.id,
    economicDate: request.economicDate,
    postingPeriodId: period?.periodId ?? null,
    isLatePosting: period?.isLatePosting ?? false,
    branchId: branch.id,
    ...(request.counterpartyName === undefined
      ? {}
      : { counterpartyName: request.counterpartyName }),
    ...(request.description === undefined
      ? {}
      : { description: request.description }),
    amountMinor: BigInt(request.amountMinor),
    currency: request.currency,
    paymentMethod: request.paymentMethod,
    ...(request.paymentReference === undefined
      ? {}
      : { paymentReference: request.paymentReference }),
    ...(request.sourceReference === undefined
      ? {}
      : { sourceReference: request.sourceReference }),
    estimateStatus: request.estimateStatus,
    status,
    ...(postedAt === undefined ? {} : { postedAt }),
    createdByCommandId: envelope.commandId,
    createdAt,
  });

  const postingRows = postingRowsFor(ctx, envelope, {
    entryId: request.entryId,
    facts: request,
    categoryId: category.id,
    branchId: branch.id,
    postingPeriodId: period?.periodId ?? null,
    createdAt,
  });
  await tx.insert(financialPostings).values(postingRows);

  await appendAuditEvent(tx, ctx, envelope, {
    eventType: isPosted
      ? "financial_entry.posted"
      : "financial_entry.submitted",
    entityType: "financial_entry",
    entityId: request.entryId,
    afterState: {
      id: request.entryId,
      workspaceId: ctx.workspaceId,
      entryNumber,
      direction: request.direction,
      categoryId: category.id,
      economicDate: request.economicDate,
      postingPeriodId: period?.periodId ?? null,
      isLatePosting: period?.isLatePosting ?? false,
      branchId: branch.id,
      counterpartyName: request.counterpartyName ?? null,
      description: request.description ?? null,
      amountMinor: request.amountMinor,
      currency: request.currency,
      paymentMethod: request.paymentMethod,
      paymentReference: request.paymentReference ?? null,
      sourceReference: request.sourceReference ?? null,
      estimateStatus: request.estimateStatus,
      status,
      rejectedReason: null,
      reversesEntryId: null,
      postedAt: postedAt?.toISOString() ?? null,
      rowVersion: 1,
      createdByCommandId: envelope.commandId,
      createdAt: createdAt.toISOString(),
      postings: auditPostings(postingRows),
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
    entryId: request.entryId,
    entryNumber,
    status,
    warnings,
  };
}

/**
 * Every reference the entry's facts name, checked the same way whether the
 * entry is being recorded or its author is editing it while it waits: the
 * category of the right kind, and each line's vehicle, trip, work order and
 * person. Returns the category the entry is booked to.
 */
export async function resolveEntryReferences(
  tx: Tx,
  ctx: CommandContext,
  request: Pick<
    FinancialEntryFacts,
    "direction" | "categoryCode" | "categoryKind" | "categoryRefType" | "postings"
  >,
  origin: CommandOrigin,
): Promise<EntryCategory> {
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
        eq(categories.code, request.categoryCode),
        eq(categories.active, true),
      ),
    );
  const category = categoryMatches.find(
    (candidate) => candidate.kind === request.categoryKind,
  );
  if (!category) {
    if (categoryMatches.length > 0) {
      throw new CommandError(422, "CATEGORY_KIND_MISMATCH", {
        categoryCode: request.categoryCode,
        expectedKind: request.categoryKind,
      });
    }
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: request.categoryRefType,
      referenceCode: request.categoryCode,
    });
  }

  const requestedAssetIds = [
    ...new Set(
      request.postings.flatMap((posting) =>
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

  const requestedActivityIds = [
    ...new Set(
      request.postings.flatMap((posting) =>
        posting.activityId === undefined ? [] : [posting.activityId],
      ),
    ),
  ];
  if (requestedActivityIds.length > 0) {
    const activityRows = await tx
      .select({ id: activities.id })
      .from(activities)
      .where(
        and(
          eq(activities.workspaceId, ctx.workspaceId),
          inArray(activities.id, requestedActivityIds),
        ),
      );
    const activityIds = new Set(activityRows.map((activity) => activity.id));
    const missing = requestedActivityIds.filter(
      (activityId) => !activityIds.has(activityId),
    );
    if (missing.length > 0) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "activity",
        missing,
      });
    }
    // A driver puts money on their own trips only (#592).
    for (const activityId of requestedActivityIds) {
      await assertOwnTrip(tx, ctx, ["DRIVER"], { id: activityId }, origin);
    }
  }

  const requestedWorkOrderIds = [
    ...new Set(
      request.postings.flatMap((posting) =>
        posting.workOrderId === undefined ? [] : [posting.workOrderId],
      ),
    ),
  ];
  if (requestedWorkOrderIds.length > 0) {
    if (request.direction === "REVENUE") {
      throw new CommandError(422, "WORK_ORDER_COST_ONLY", {
        workOrderId: requestedWorkOrderIds[0],
      });
    }
    const workOrderRows = await tx
      .select({
        id: workOrders.id,
        status: workOrders.status,
        assetId: workOrders.assetId,
        branchId: assets.branchId,
      })
      .from(workOrders)
      .innerJoin(
        assets,
        and(eq(assets.workspaceId, workOrders.workspaceId), eq(assets.id, workOrders.assetId)),
      )
      .where(
        and(
          eq(workOrders.workspaceId, ctx.workspaceId),
          inArray(workOrders.id, requestedWorkOrderIds),
        ),
      );
    const workOrdersById = new Map(workOrderRows.map((row) => [row.id, row]));
    const missing = requestedWorkOrderIds.filter(
      (workOrderId) => !workOrdersById.has(workOrderId),
    );
    if (missing.length > 0) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "workOrder",
        missing,
      });
    }
    // Branch scope reads through the order's asset (#47 finding 3): with the
    // posting's assetId omitted, nothing else would stop a member from putting
    // spend on another branch's repair. Same refusal as the pipeline's own
    // branch check, so an out-of-scope order is indistinguishable from an
    // out-of-scope asset.
    if (ctx.branchScope !== "ALL") {
      const scope = ctx.branchScope;
      const outside = workOrderRows.find((row) => !scope.includes(row.branchId));
      if (outside) {
        throw new CommandError(403, "ROLE_FORBIDDEN", {
          referenceType: "workOrder",
          workOrderId: outside.id,
        });
      }
    }
    for (const posting of request.postings) {
      if (posting.workOrderId === undefined || posting.assetId === undefined) continue;
      const workOrder = workOrdersById.get(posting.workOrderId)!;
      if (workOrder.assetId !== posting.assetId) {
        throw new CommandError(422, "WORK_ORDER_ASSET_MISMATCH", {
          workOrderId: workOrder.id,
          workOrderAssetId: workOrder.assetId,
          assetId: posting.assetId,
        });
      }
    }
    // Costs attach only to APPROVED work (#28): SUBMITTED spend is not yet
    // authorized, and COMPLETED, REJECTED and CANCELLED orders are closed to
    // new cost. Reversals do not come through here — they copy the original
    // attribution and are always allowed.
    const notOpen = workOrderRows.find((row) => row.status !== "APPROVED");
    if (notOpen) {
      throw new CommandError(409, "WORK_ORDER_NOT_OPEN", {
        workOrderId: notOpen.id,
        status: notOpen.status,
      });
    }
  }

  const requestedPersonIds = [
    ...new Set(
      request.postings.flatMap((posting) =>
        posting.personId === undefined ? [] : [posting.personId],
      ),
    ),
  ];
  if (requestedPersonIds.length > 0) {
    const personRows = await tx
      .select({ id: persons.id })
      .from(persons)
      .where(
        and(
          eq(persons.workspaceId, ctx.workspaceId),
          inArray(persons.id, requestedPersonIds),
        ),
      );
    const personIds = new Set(personRows.map((person) => person.id));
    const missing = requestedPersonIds.filter(
      (personId) => !personIds.has(personId),
    );
    if (missing.length > 0) {
      throw new CommandError(422, "REFERENCE_NOT_FOUND", {
        referenceType: "person",
        missing,
      });
    }
  }

  return category;
}

export interface PostingDecision {
  isPosted: boolean;
  period: Awaited<ReturnType<typeof resolvePostingPeriod>> | undefined;
  warnings: CommandWarningCode[];
}

/** An auto-approved entry takes its posting period now; a locked one defers it to SUBMITTED. */
export async function resolvePostingOrDefer(
  tx: Tx,
  ctx: CommandContext,
  envelope: CommandEnvelope,
  economicDate: string,
  approval: ApprovalDecision,
): Promise<PostingDecision> {
  if (approval.outcome !== "AUTO_APPROVED") {
    return { isPosted: false, period: undefined, warnings: [] };
  }
  try {
    const period = await resolvePostingPeriod(tx, ctx, economicDate, envelope.commandId);
    return { isPosted: true, period, warnings: [] };
  } catch (error) {
    // §4.3 scopes period lock to financial rows; operational records are
    // governed by activity close. A composite sheet binds both into one
    // transaction, so throwing here would destroy the legs, readings and
    // segments sharing it — the exact opposite of §6's "the server doesn't get
    // to reject reality". Degrade this entry to SUBMITTED instead and let
    // approve-entry resolve the period later, which is where it belongs.
    // Strictly more conservative than posting: SUBMITTED never counts in
    // default reports (§3.4 inv. 9).
    if (!(error instanceof CommandError) || error.code !== "PERIOD_LOCKED") throw error;
    return { isPosted: false, period: undefined, warnings: ["POSTING_DEFERRED_PERIOD_LOCKED"] };
  }
}

/**
 * The same predicate the reads use for the entry's evidence state, so the
 * warning at capture and the badge on the list can never disagree.
 */
export function evidenceMissing(
  category: EntryCategory,
  facts: Pick<FinancialEntryFacts, "paymentMethod" | "paymentReference">,
  artifactCount: number,
): boolean {
  return (
    entryEvidenceState({
      policy: category.evidencePolicy,
      artifactCount,
      paymentMethod: facts.paymentMethod,
      paymentReference: facts.paymentReference,
    }) === "NOT_SUPPLIED"
  );
}

/** One row per line, numbered from 1, stamped with the command that wrote them. */
export function postingRowsFor(
  ctx: CommandContext,
  envelope: CommandEnvelope,
  entry: {
    entryId: string;
    facts: Pick<FinancialEntryFacts, "direction" | "economicDate" | "postings">;
    categoryId: string;
    branchId: string;
    postingPeriodId: string | null;
    createdAt: Date;
  },
) {
  return entry.facts.postings.map((posting, index) => ({
    id: crypto.randomUUID(),
    workspaceId: ctx.workspaceId,
    financialEntryId: entry.entryId,
    lineNo: index + 1,
    economicDate: entry.facts.economicDate,
    postingPeriodId: entry.postingPeriodId,
    direction: entry.facts.direction,
    categoryId: entry.categoryId,
    branchId: entry.branchId,
    ...(posting.assetId === undefined ? {} : { assetId: posting.assetId }),
    ...(posting.activityId === undefined
      ? {}
      : { activityId: posting.activityId }),
    ...(posting.workOrderId === undefined
      ? {}
      : { workOrderId: posting.workOrderId }),
    ...(posting.personId === undefined ? {} : { personId: posting.personId }),
    amountMinor: BigInt(posting.amountMinor),
    assetAttribution: posting.assetAttribution,
    activityAttribution: posting.activityAttribution ?? "DIRECT",
    createdByCommandId: envelope.commandId,
    createdAt: entry.createdAt,
  }));
}

/** Posting rows as the audit trail stores them: JSON-safe, nulls explicit. */
export function auditPostings(rows: ReturnType<typeof postingRowsFor>) {
  return rows.map((posting) => ({
    ...posting,
    assetId: posting.assetId ?? null,
    amountMinor: Number(posting.amountMinor),
    createdAt: posting.createdAt.toISOString(),
  }));
}
