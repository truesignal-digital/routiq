import type { CommandSubmission, SubmissionOptions } from "@asset/contracts";
import type { CommandClient, SubmitResult } from "./client.js";
import { SubmissionCache } from "./submission-cache.js";

export interface CommandIntent<P> {
  /** Submit (or retry) this intent. Unchanged payload+options reuse the
   * identical envelope — same commandId + idempotencyKey — so retries
   * replay (§5.3); a changed expectedVersion is a new intent. */
  submit(payload: P, options?: SubmissionOptions): Promise<SubmitResult>;
  current(payload: P, options?: SubmissionOptions): CommandSubmission<P>;
}

/** One user intent = one envelope. Screens hold one intent per form. */
export function createCommandIntent<P>(
  client: CommandClient,
  name: string,
  version: number,
): CommandIntent<P> {
  const cache = new SubmissionCache<P>(name, version);
  return {
    current: (payload, options) => cache.for(payload, options),
    submit: (payload, options) => client.submit(cache.for(payload, options)),
  };
}
