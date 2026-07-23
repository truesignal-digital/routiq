/**
 * STUB (ticket 10): no-op until Sentry wiring lands. The real implementation
 * initializes from SENTRY_DSN (absent = disabled) and reports ONLY unexpected
 * failures, with command tags and never payload contents.
 */
export interface FailureTags {
  commandId: string;
  workspaceId: string;
  commandType: string;
  origin: string;
}

export function reportUnexpectedFailure(_error: unknown, _tags: FailureTags): void {}
