import type { CommandEnvelope } from "../envelope.js";
import type { CommandWarningCode } from "../errors.js";

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

/**
 * One record a composite command created alongside its main record. The client
 * generated the ids, so what it cannot know is the per-child outcome: which
 * embedded expense posted and which is waiting for an approver. Rendering
 * "2 lignes en attente" must not cost a round trip — an offline outbox has only
 * the queued response to work from.
 */
export interface CommandResultChild {
  entityType: "financial_entry";
  id: string;
  status: string;
  warnings: CommandWarningCode[];
}

/** Outcome of a successfully committed command, as returned by the API. */
export interface CommandResult {
  commandId: string;
  recordId: string;
  rowVersion: number;
  recordStatus?: string;
  warnings: CommandWarningCode[];
  /** Details for a warning that names other records (ADR-0012 §4 `tripIds`); absent otherwise. */
  warningMetadata?: CommandWarningMetadata;
  /** Composite commands only; absent for the single-record majority. */
  children?: CommandResultChild[];
  idempotentReplay: boolean;
}

export type CommandWarningMetadata = Partial<Record<CommandWarningCode, Record<string, unknown>>>;
