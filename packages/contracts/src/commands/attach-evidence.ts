import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

export const ATTACH_EVIDENCE_MAX_FILES = 10;

/**
 * Links files to an entry that already exists, without editing it: the entry's
 * amount, status and version stay exactly as they were. `artifactIds` repeats
 * the envelope's `sourceArtifactIds` on purpose — the dispatcher links and
 * workspace-checks the envelope's, while the payload is what the idempotency
 * hash and the audit event cover. The two must name the same set.
 */
export const attachEvidencePayload = z.strictObject({
  entryId: z.uuid(),
  artifactIds: z
    .array(z.uuid())
    .min(1)
    .max(ATTACH_EVIDENCE_MAX_FILES)
    .refine((ids) => new Set(ids).size === ids.length, { message: "artifact_ids_repeated" }),
});

export const attachEvidenceCommand = z.object({
  name: z.literal("attach-evidence"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: attachEvidencePayload,
});

export type AttachEvidencePayload = z.infer<typeof attachEvidencePayload>;
export type AttachEvidenceCommand = z.infer<typeof attachEvidenceCommand>;
