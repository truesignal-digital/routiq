import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

export const addOrRenewDocumentPayload = z.object({
  documentId: z.uuid(),
  assetId: z.uuid(),
  documentTypeCode: z.string().min(1),
  title: z.string().max(200).optional(),
  documentNumber: z.string().max(100).optional(),
  issuedAt: z.iso.date().optional(),
  expiresAt: z.iso.date().optional(),
  supersedesDocumentId: z.uuid().optional(),
});

export const addOrRenewDocumentCommand = z.object({
  name: z.literal("add-or-renew-document"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: addOrRenewDocumentPayload,
});

export type AddOrRenewDocumentPayload = z.infer<typeof addOrRenewDocumentPayload>;
export type AddOrRenewDocumentCommand = z.infer<typeof addOrRenewDocumentCommand>;
