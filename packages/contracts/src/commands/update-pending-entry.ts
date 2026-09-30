import { z } from "zod";
import { commandEnvelope } from "../envelope.js";
import { financialEntryPayload } from "./record-financial-entry.js";

/**
 * The author's own edit of an entry still waiting for a decision (#85, level 2
 * of ADR-0008): the recording form's fields, pre-filled and sent back whole.
 * Every field replaces the stored one, so an optional field left out clears it.
 *
 * Two things stay where the entry was recorded. The branch, because the entry
 * number is drawn from its sequence and the approver's queue is scoped by it;
 * a wrong branch is a rejection and a new entry. The direction, because an
 * expense and a revenue are different commands with different approval rules;
 * the handler reads it from the stored entry.
 *
 * Strict, so a client that still sends `branchCode` hears that it is ignored
 * rather than believing it moved the entry.
 */
export const updatePendingEntryPayload = z.strictObject(
  financialEntryPayload.omit({ branchCode: true }).shape,
);

export const updatePendingEntryCommand = z.object({
  name: z.literal("update-pending-entry"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: updatePendingEntryPayload,
});

export type UpdatePendingEntryPayload = z.infer<typeof updatePendingEntryPayload>;
export type UpdatePendingEntryCommand = z.infer<typeof updatePendingEntryCommand>;
