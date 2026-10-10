import type {
  CompleteWorkOrderInput,
  WorkOrderCostOutcome,
  WorkOrderDetail,
} from "@routiq/contracts";
import { parseMoneyXaf } from "../lib/format.js";

/**
 * The money half of closing a work order (#81), as pure functions over the
 * form's state: what is already in the books, which choice the form opens on,
 * and the v2 payload a choice becomes.
 */

/**
 * What the closer says about the cost:
 * - AMOUNT: one or more amounts to record now.
 * - NOTHING_MORE: costs are already recorded and nothing is added.
 * - NO_COST / INVOICE_PENDING: the two explicit alternatives.
 */
export type CostChoice = "AMOUNT" | "NOTHING_MORE" | "NO_COST" | "INVOICE_PENDING";

export interface CostLineDraft {
  /** Generated once per line, so a retried submit replays the same entry. */
  entryId: string;
  categoryCode: string;
  amountInput: string;
  note: string;
  artifactIds: string[];
}

/** The repair category every close pre-fills (core pack `REPAIRS`). */
export const REPAIR_CATEGORY_CODE = "REPAIRS";

export function newCostLine(categoryCode = REPAIR_CATEGORY_CODE): CostLineDraft {
  return {
    entryId: crypto.randomUUID(),
    categoryCode,
    amountInput: "",
    note: "",
    artifactIds: [],
  };
}

export interface RecordedCost {
  /** Signed sum: a reversal pair nets to zero. */
  totalMinor: number;
  /** Lines that still stand: neither a reversed original nor its reversal. */
  count: number;
}

/** What the order's cost lines already say, posted and pending alike. */
export function recordedCost(
  detail: Pick<WorkOrderDetail, "costLines" | "pendingCostLines">,
): RecordedCost {
  const lines = [...(detail.costLines ?? []), ...(detail.pendingCostLines ?? [])];
  return {
    totalMinor: lines.reduce((sum, line) => sum + line.amountMinor, 0),
    count: lines.filter((line) => line.entryStatus !== "REVERSED" && line.amountMinor > 0)
      .length,
  };
}

/**
 * The form never opens on a silent close. With cost in the books, "nothing to
 * add" is the default; otherwise the amount — which is empty, so the close
 * stays shut until the closer types one or picks an alternative. Without the
 * right to record cost, no choice is made for them.
 */
export function defaultCostChoice(recorded: RecordedCost, canRecordCost: boolean): CostChoice | null {
  if (recorded.totalMinor !== 0) return "NOTHING_MORE";
  return canRecordCost ? "AMOUNT" : null;
}

export function lineAmount(line: CostLineDraft): number | null {
  const amount = parseMoneyXaf(line.amountInput);
  return amount !== null && amount > 0 ? amount : null;
}

export interface CompletionCost {
  costOutcome: WorkOrderCostOutcome;
  costLines: NonNullable<CompleteWorkOrderInput["costLines"]>;
  /** The envelope's files: exactly the lines' photos. */
  sourceArtifactIds: string[];
}

/** The v2 cost half of the payload, or null while the choice is incomplete. */
export function toCompletionCost(
  choice: CostChoice | null,
  lines: readonly CostLineDraft[],
  economicDate: string,
): CompletionCost | null {
  switch (choice) {
    case null:
      return null;
    case "NOTHING_MORE":
      return { costOutcome: "LINES", costLines: [], sourceArtifactIds: [] };
    case "NO_COST":
    case "INVOICE_PENDING":
      return { costOutcome: choice, costLines: [], sourceArtifactIds: [] };
    case "AMOUNT": {
      if (lines.length === 0) return null;
      const costLines: CompletionCost["costLines"] = [];
      for (const line of lines) {
        const amountMinor = lineAmount(line);
        if (amountMinor === null || line.categoryCode === "") return null;
        const note = line.note.trim();
        costLines.push({
          entryId: line.entryId,
          categoryCode: line.categoryCode,
          amountMinor,
          economicDate,
          ...(note === "" ? {} : { note }),
          ...(line.artifactIds.length === 0 ? {} : { evidenceArtifactIds: line.artifactIds }),
        });
      }
      return {
        costOutcome: "LINES",
        costLines,
        sourceArtifactIds: lines.flatMap((line) => line.artifactIds),
      };
    }
  }
}
