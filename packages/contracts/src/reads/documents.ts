import { z } from "zod";

export const assetDocumentRead = z.object({
  id: z.uuid(),
  type: z.object({ code: z.string(), labelFr: z.string(), labelEn: z.string() }),
  title: z.string().nullable(),
  documentNumber: z.string().nullable(),
  issuedAt: z.iso.date().nullable(),
  expiresAt: z.iso.date().nullable(),
  supersedesDocumentId: z.uuid().nullable(),
  supersededByDocumentId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  /** Files attached when the document was recorded (its command's source artifacts). */
  artifactCount: z.number().int().nonnegative(),
});

export const assetDocumentsReadResponse = z.object({
  assetId: z.uuid(),
  documents: z.array(assetDocumentRead),
});

export type AssetDocumentRead = z.infer<typeof assetDocumentRead>;
export type AssetDocumentsReadResponse = z.infer<typeof assetDocumentsReadResponse>;
