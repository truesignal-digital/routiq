import { createSubmission, type CommandSubmission, type SubmissionOptions } from "@asset/contracts";

/**
 * Retrying an unchanged form must re-post the SAME submission (same
 * idempotency key → server replays, §5.3); an edited form is a new
 * submission (reusing the key with a different payload would 409).
 */
export class SubmissionCache<P> {
  private entry: { fingerprint: string; submission: CommandSubmission<P> } | undefined;

  constructor(
    private name: string,
    private version: number,
  ) {}

  for(payload: P, options?: SubmissionOptions): CommandSubmission<P> {
    // Options are part of the fingerprint: a reloaded expectedVersion is a
    // NEW intent — reusing the old key would replay a stale-version attempt.
    const fingerprint = JSON.stringify({ payload, options });
    if (this.entry?.fingerprint !== fingerprint) {
      this.entry = {
        fingerprint,
        submission: createSubmission(this.name, this.version, payload, options),
      };
    }
    return this.entry.submission;
  }
}
