import { createHash } from "node:crypto";
import { routeTemplate, telemetryBatch, type TelemetryEvent } from "@routiq/contracts";
import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { resolveAuthContext } from "../auth/context.js";
import type { AuthContext, IdentityProvider } from "../auth/types.js";
import type { Db } from "../db/client.js";
import { telemetryEvents } from "../db/schema.js";

/** Days a telemetry event is kept (ADR-0011). */
export const TELEMETRY_RETENTION_DAYS = 90;

/** Events one sender (a workspace, or an address before sign-in) may send per minute. */
export const TELEMETRY_EVENTS_PER_MINUTE = 300;

/**
 * Groups one error across sessions and releases: the message with its numbers
 * and quoted values blanked, plus the first frame inside the app's code with
 * its line and column dropped (they move with every build).
 */
export function errorFingerprint(message: string, stack: string | undefined): string {
  const shape = message.replace(/(["'`]).*?\1/g, "?").replace(/\d+/g, "#").trim();
  const frame = (stack ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.includes("/src/") || line.includes("/static/"))
    ?.replace(/:\d+:\d+\)?$/, "")
    .replace(/-[A-Za-z0-9_-]{8}\.js/, ".js");
  return createHash("sha256").update(`${shape}\n${frame ?? ""}`).digest("hex").slice(0, 16);
}

export function toRow(event: TelemetryEvent, auth: Pick<AuthContext, "workspaceId" | "role"> | undefined): typeof telemetryEvents.$inferInsert {
  const common = {
    occurredAt: new Date(event.occurredAt),
    workspaceId: auth?.workspaceId ?? null,
    role: auth?.role ?? null,
    sessionId: event.sessionId,
    kind: event.kind,
    route: routeTemplate(event.route),
    appVersion: event.appVersion,
  };
  switch (event.kind) {
    case "session":
      return { ...common, device: event.device, detail: event.navigation ?? null };
    case "error":
      return { ...common, name: event.source, message: event.message, stack: event.stack ?? null, fingerprint: errorFingerprint(event.message, event.stack) };
    case "vital":
      return { ...common, name: event.name, value: event.value };
    case "journey":
      return { ...common, name: event.name, value: event.durationMs, outcome: event.outcome, serverMs: event.serverMs ?? null };
  }
}

/** A fixed one-minute window per sender; enough to stop a runaway client, not a security boundary. */
export function makeRateLimiter(limit: number, now: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>();
  return (key: string, events: number): boolean => {
    const at = now();
    const current = windows.get(key);
    if (current === undefined || at - current.start >= 60_000) {
      if (windows.size > 10_000) windows.clear();
      windows.set(key, { start: at, count: events });
      return events <= limit;
    }
    current.count += events;
    return current.count <= limit;
  };
}

async function optionalAuth(req: FastifyRequest, authDb: Db, identity: IdentityProvider): Promise<AuthContext | undefined> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  // An expired session still reports what happened; it just loses its workspace.
  const verified = await identity.verifyToken(header.slice("Bearer ".length)).catch(() => null);
  if (!verified) return undefined;
  return (await resolveAuthContext(authDb, verified)) ?? undefined;
}

export async function pruneTelemetry(db: Db, days = TELEMETRY_RETENTION_DAYS): Promise<number> {
  const result = await db.execute(sql`delete from telemetry.events where received_at < now() - make_interval(days => ${days})`);
  return result.rowCount ?? 0;
}

/**
 * `POST /v1/telemetry` (ADR-0011): accepts a batch from the web app, with or
 * without a session. Writes straight to telemetry.events with the runtime
 * role, outside the command pipeline: these are measurements, not facts a
 * tenant owns. Answers 202 whatever the session's state, so a measurement
 * never fails the user's screen.
 */
export function registerTelemetryRoutes(app: FastifyInstance, db: Db, authDb: Db, identity: IdentityProvider): void {
  const allow = makeRateLimiter(TELEMETRY_EVENTS_PER_MINUTE);

  app.post("/v1/telemetry", { bodyLimit: 128 * 1024 }, async (req, reply) => {
    const parsed = telemetryBatch.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
    const auth = await optionalAuth(req, authDb, identity);
    if (!allow(auth?.workspaceId ?? `ip:${req.ip}`, parsed.data.events.length)) {
      return reply.status(429).send({ error: { code: "RATE_LIMITED" } });
    }
    await db.insert(telemetryEvents).values(parsed.data.events.map((event) => toRow(event, auth)));
    return reply.status(202).send({ accepted: parsed.data.events.length });
  });

  let timer: NodeJS.Timeout | undefined;
  app.addHook("onReady", async () => {
    const prune = () =>
      pruneTelemetry(db).catch((error: unknown) => app.log.error({ err: error, event: "telemetry.prune_failed" }));
    await prune();
    timer = setInterval(() => void prune(), 24 * 60 * 60 * 1000);
    timer.unref();
  });
  app.addHook("onClose", async () => {
    if (timer !== undefined) clearInterval(timer);
  });
}
