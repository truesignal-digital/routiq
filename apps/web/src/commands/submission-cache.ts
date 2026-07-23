import { createSubmission, type CommandSubmission } from "@asset/contracts";

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

  for(payload: P): CommandSubmission<P> {
    const fingerprint = JSON.stringify(payload);
    if (this.entry?.fingerprint !== fingerprint) {
      this.entry = { fingerprint, submission: createSubmission(this.name, this.version, payload) };
    }
    return this.entry.submission;
  }
}
