import * as Sentry from "@sentry/node";

let initialized = false;
let enabled = false;

export interface FailureTags {
  commandId: string;
  workspaceId: string;
  commandType: string;
  origin: string;
}

export interface SentryOptions {
  dsn?: string | undefined;
  transport?: unknown;
}

export function initSentry(opts?: SentryOptions): boolean {
  if (initialized) return enabled;
  initialized = true;

  const dsn = opts?.dsn ?? process.env["SENTRY_DSN"];
  if (!dsn) {
    enabled = false;
    return false;
  }

  enabled = true;
  const config: Parameters<typeof Sentry.init>[0] = {
    dsn,
    defaultIntegrations: false,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
  };
  if (opts?.transport) {
    config.transport = opts.transport as NonNullable<NonNullable<typeof config>["transport"]>;
  }

  Sentry.init(config);

  return true;
}

export function reportUnexpectedFailure(error: unknown, tags: FailureTags): void {
  if (!enabled) return;
  Sentry.captureException(error, {
    tags: {
      commandId: tags.commandId,
      workspaceId: tags.workspaceId,
      commandType: tags.commandType,
      origin: tags.origin,
    },
  });
}

export function isSentryEnabled(): boolean {
  return enabled;
}

export function _resetSentryForTests(): void {
  initialized = false;
  enabled = false;
  Sentry.close(0);
}
