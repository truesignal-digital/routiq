import { z } from "zod";

/**
 * A file attached to a record, as that record's read lists it. It downloads
 * through the record's own route — the document's, the issue's, the finance
 * entry's — which authorizes the record first. The generic
 * `/v1/artifacts/:id/download-url` serves only the caller's own uploads that
 * no command has linked yet.
 */
export const recordArtifact = z.object({
  artifactId: z.uuid(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  originalFileName: z.string().nullable(),
});

export type RecordArtifact = z.infer<typeof recordArtifact>;
