import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * Why an entry is cancelled (#426), from a short list so the reasons can be
 * counted. "Cancel entry" is the words people see; underneath it stays a
 * reversal. Order is the order the dialog offers them.
 */
export const CANCELLATION_REASON_CODES = [
  "ENTERED_TWICE",
  "DID_NOT_HAPPEN",
  "WRONG_DETAILS",
  "OTHER",
] as const;

export const cancellationReasonCode = z.enum(CANCELLATION_REASON_CODES);
export type CancellationReasonCode = z.infer<typeof cancellationReasonCode>;

/** v2: the reason is a code; free text is required for OTHER only. */
export const reverseEntryPayload = z
  .strictObject({
    reversalEntryId: z.uuid(),
    originalEntryId: z.uuid(),
    reasonCode: cancellationReasonCode,
    reasonText: z.string().trim().min(1).max(500).optional(),
  })
  .refine((payload) => payload.reasonCode !== "OTHER" || payload.reasonText !== undefined, {
    message: "reasonText is required when reasonCode is OTHER",
    path: ["reasonText"],
  });

export const reverseEntryCommand = z.object({
  name: z.literal("reverse-entry"),
  version: z.literal(2),
  envelope: commandEnvelope,
  payload: reverseEntryPayload,
});

/** Frozen: what v1 receipts and not-yet-updated clients say. */
export const reverseEntryV1Payload = z.object({
  reversalEntryId: z.uuid(),
  originalEntryId: z.uuid(),
  reason: z.string().min(1).max(500),
});

export const reverseEntryV1Command = z.object({
  name: z.literal("reverse-entry"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: reverseEntryV1Payload,
});

/** A v1 free-text reason is an OTHER reason with that text. */
export function reverseEntryV1ToV2(payload: ReverseEntryV1Payload): ReverseEntryPayload {
  return {
    reversalEntryId: payload.reversalEntryId,
    originalEntryId: payload.originalEntryId,
    reasonCode: "OTHER",
    reasonText: payload.reason,
  };
}

export type ReverseEntryPayload = z.infer<typeof reverseEntryPayload>;
export type ReverseEntryCommand = z.infer<typeof reverseEntryCommand>;
export type ReverseEntryV1Payload = z.infer<typeof reverseEntryV1Payload>;
export type ReverseEntryV1Command = z.infer<typeof reverseEntryV1Command>;
