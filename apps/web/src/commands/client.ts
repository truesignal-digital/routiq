import type { CommandResult, CommandSubmission } from "@asset/contracts";
import { extractApiError } from "../lib/api-error.js";
import type { CommandStatusStore } from "./store.js";

export type SubmitResult =
  | { ok: true; outcome: CommandResult }
  | { ok: false; code: string; metadata?: Record<string, unknown> };

export interface CommandClientDeps {
  store: CommandStatusStore;
  getToken: () => string | undefined;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface CommandClient {
  submit<P>(submission: CommandSubmission<P>): Promise<SubmitResult>;
}

/**
 * The single seam every form writes through (web-foundation spec Q3).
 * Forms never see HTTP; the offline outbox later swaps this transport for
 * an enqueue without touching callers. Retrying a failed submission means
 * calling submit() again with the SAME submission object — its envelope ids
 * never regenerate, so the server replays instead of duplicating.
 */
export function createCommandClient({
  store,
  getToken,
  baseUrl = "",
  fetchImpl = fetch,
}: CommandClientDeps): CommandClient {
  return {
    async submit(submission) {
      const { commandId } = submission.envelope;
      store.markSubmitting(commandId);

      let response: Response;
      try {
        const token = getToken();
        response = await fetchImpl(`${baseUrl}/v1/commands`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          },
          body: JSON.stringify({
            name: submission.name,
            version: submission.version,
            envelope: submission.envelope,
            payload: submission.payload,
          }),
        });
      } catch {
        store.markRejected(commandId, "NETWORK_ERROR");
        return { ok: false, code: "NETWORK_ERROR" };
      }

      const body: unknown = await response.json().catch(() => undefined);

      if (response.ok && isCommandResult(body)) {
        store.markCommitted(commandId, body);
        return { ok: true, outcome: body };
      }

      const { code, metadata } = extractApiError(body, "COMMAND_FAILED");
      store.markRejected(commandId, code, metadata);
      return { ok: false, code, ...(metadata === undefined ? {} : { metadata }) };
    },
  };
}

function isCommandResult(body: unknown): body is CommandResult {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as CommandResult).commandId === "string" &&
    typeof (body as CommandResult).recordId === "string" &&
    typeof (body as CommandResult).rowVersion === "number"
  );
}
