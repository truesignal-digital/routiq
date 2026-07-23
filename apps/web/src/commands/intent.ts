import type { CommandSubmission } from "@asset/contracts";
import type { CommandClient, SubmitResult } from "./client.js";
import { SubmissionCache } from "./submission-cache.js";

export interface CommandIntent<P> {
  /** Submit (or retry) this intent. Unchanged payload reuses the identical
   * envelope — same commandId + idempotencyKey — so retries replay (§5.3). */
  submit(payload: P): Promise<SubmitResult>;
  current(payload: P): CommandSubmission<P>;
}

/** One user intent = one envelope. Screens hold one intent per form. */
export function createCommandIntent<P>(
  client: CommandClient,
  name: string,
  version: number,
): CommandIntent<P> {
  const cache = new SubmissionCache<P>(name, version);
  return {
    current: (payload) => cache.for(payload),
    submit: (payload) => client.submit(cache.for(payload)),
  };
}
