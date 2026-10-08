import { z } from "zod";
import { commandEnvelope, currencyCode, moneyMinor } from "../envelope.js";

/**
 * What the closer says about the repair's cost (#81). Closing is where money is
 * declared, so every v2 close names one of these — there is no "didn't say".
 *
 * - `LINES`: the cost is in the books — the lines this close carries, the ones
 *   already recorded against the order, or both.
 * - `NO_COST`: the repair cost nothing (warranty, in-house work). Refused when
 *   the order already carries cost.
 * - `INVOICE_PENDING`: the work is done, the invoice has not arrived. The order
 *   closes with no new cost and reads as cost-pending until one is added (#82).
 */
export const WORK_ORDER_COST_OUTCOMES = ["LINES", "NO_COST", "INVOICE_PENDING"] as const;
export const workOrderCostOutcome = z.enum(WORK_ORDER_COST_OUTCOMES);
export type WorkOrderCostOutcome = z.infer<typeof workOrderCostOutcome>;

export const COMPLETE_WORK_ORDER_MAX_COST_LINES = 10;
export const COMPLETE_WORK_ORDER_MAX_FILES_PER_LINE = 10;

/**
 * One expense the close writes, charged to the order and its truck. The server
 * fills in the rest: the truck's branch, the posting to the truck and the order.
 * Each line follows record-expense's approval rules on its own.
 */
export const completionCostLine = z.strictObject({
  /** Client-generated, like every entry id: the outbox knows what it created. */
  entryId: z.uuid(),
  categoryCode: z.string().min(1).max(80),
  amountMinor: moneyMinor.positive().max(Number.MAX_SAFE_INTEGER),
  economicDate: z.iso.date(),
  /** The close form does not ask; cash is what the add-cost form pre-selects too. */
  paymentMethod: z.enum(["CASH", "MOMO", "OM", "BANK", "OTHER"]).default("CASH"),
  note: z.string().trim().min(1).max(500).optional(),
  /**
   * The receipt photos for this line. Each must also be in the envelope's
   * `sourceArtifactIds` (the dispatcher links and workspace-checks those), and
   * together the lines must name exactly that set.
   */
  evidenceArtifactIds: z
    .array(z.uuid())
    .min(1)
    .max(COMPLETE_WORK_ORDER_MAX_FILES_PER_LINE)
    .optional(),
});

export type CompletionCostLine = z.infer<typeof completionCostLine>;

const completionFields = {
  workOrderId: z.uuid(),
  currency: currencyCode.default("XAF"),
  summary: z.string().min(1).max(500).optional(),
  /**
   * Resolve the signalement this order answers, in the same transaction as the
   * completion (or its approval, when the completion is held for review).
   * Omitted means "yes" whenever the order cites an issue — the UI pre-checks
   * it — and a human unchecks it when the work is done but the problem is not.
   * Meaningless, and ignored, on preventive work with no issue behind it.
   */
  resolveLinkedIssue: z.boolean().optional(),
};

/**
 * v2: the close carries its cost. The order's actual cost is no longer typed —
 * it is the sum of the order's non-rejected cost lines, so the order and the
 * books cannot disagree.
 */
export const completeWorkOrderPayload = z
  .strictObject({
    ...completionFields,
    costOutcome: workOrderCostOutcome,
    costLines: z
      .array(completionCostLine)
      .max(COMPLETE_WORK_ORDER_MAX_COST_LINES)
      .default([]),
  })
  .superRefine((payload, ctx) => {
    if (payload.costOutcome !== "LINES" && payload.costLines.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "cost_lines_need_lines_outcome",
        path: ["costLines"],
      });
    }
    const entryIds = new Set<string>();
    const artifactIds = new Set<string>();
    payload.costLines.forEach((line, index) => {
      if (entryIds.has(line.entryId)) {
        ctx.addIssue({
          code: "custom",
          message: "entry_ids_repeated",
          path: ["costLines", index, "entryId"],
        });
      }
      entryIds.add(line.entryId);
      for (const artifactId of line.evidenceArtifactIds ?? []) {
        if (artifactIds.has(artifactId)) {
          ctx.addIssue({
            code: "custom",
            message: "artifact_ids_repeated",
            path: ["costLines", index, "evidenceArtifactIds"],
          });
        }
        artifactIds.add(artifactId);
      }
    });
  });

export const completeWorkOrderCommand = z.object({
  name: z.literal("complete-work-order"),
  version: z.literal(2),
  envelope: commandEnvelope,
  payload: completeWorkOrderPayload,
});

/**
 * Frozen: what v1 receipts and not-yet-updated clients say. The typed amount is
 * kept only as the closer's declaration (`declared_cost_minor`); it never
 * becomes the order's actual cost, which v2 derives from the books.
 */
export const completeWorkOrderV1Payload = z.object({
  ...completionFields,
  actualCostMinor: moneyMinor.nonnegative().optional(),
});

export const completeWorkOrderV1Command = z.object({
  name: z.literal("complete-work-order"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: completeWorkOrderV1Payload,
});

/** What a client sends: `costLines` and each line's `paymentMethod` may be left out. */
export type CompleteWorkOrderInput = z.input<typeof completeWorkOrderPayload>;
export type CompleteWorkOrderPayload = z.infer<typeof completeWorkOrderPayload>;
export type CompleteWorkOrderCommand = z.infer<typeof completeWorkOrderCommand>;
export type CompleteWorkOrderV1Payload = z.infer<typeof completeWorkOrderV1Payload>;
export type CompleteWorkOrderV1Command = z.infer<typeof completeWorkOrderV1Command>;
