import type { CommandEnvelope } from "../envelope.js";

/**
 * One user-initiated command submission. Created once when the user starts
 * the submission; retries re-post the SAME object so `idempotencyKey` (and
 * `commandId`) never change — that is the §5.3 replay guarantee reaching
 * the client. Shared by every client of the command API (web PWA now,
 * offline outbox and React Native later).
 */
export interface CommandSubmission<P> {
  name: string;
  version: number;
  envelope: CommandEnvelope;
  payload: P;
}

export interface SubmissionOptions {
  origin?: CommandEnvelope["origin"];
  expectedVersion?: number;
  sourceArtifactIds?: string[];
  clientOccurredAt?: string;
}

export function createSubmission<P>(
  name: string,
  version: number,
  payload: P,
  options: SubmissionOptions = {},
): CommandSubmission<P> {
  const { origin = "HUMAN_UI", expectedVersion, sourceArtifactIds, clientOccurredAt } = options;
  return {
    name,
    version,
    payload,
    envelope: {
      commandId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      origin,
      sourceArtifactIds: sourceArtifactIds ?? [],
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
      ...(clientOccurredAt === undefined ? {} : { clientOccurredAt }),
    },
  };
}

/** Outcome of a successfully committed command, as returned by the API. */
export interface CommandResult {
  commandId: string;
  recordId: string;
  rowVersion: number;
  warnings: string[];
  idempotentReplay: boolean;
}
