import "dotenv/config";
import { sql } from "drizzle-orm";
import Fastify from "fastify";
import { LocalSessionProvider } from "./auth/local.js";
import { makeRequireAuth, registerAuthRoutes } from "./auth/plugin.js";
import type { IdentityProvider } from "./auth/types.js";
import "./commands/register-asset.js";
import "./commands/module-toggle.js";
import "./commands/asset-lifecycle.js";
import { registerArtifactRoutes } from "./artifacts/routes.js";
import { listCommands } from "./commands/dispatcher.js";
import { registerCommandRoutes } from "./commands/routes.js";
import type { Db } from "./db/client.js";
import type { ObjectStorage } from "./storage/types.js";
import { registerAssetReadRoutes } from "./reads/assets.js";

export interface ServerDeps {
  db: Db;
  identity?: IdentityProvider;
  storage?: ObjectStorage;
  logger?: boolean | object;
}

export function buildServer({
  db,
  identity = new LocalSessionProvider(db),
  storage,
  logger = true,
}: ServerDeps) {
  // Auto request-logging is off because Fastify's completion line binds reply.log
  // before routes can attach commandId/workspaceId (§8: both on every log line).
  const app = Fastify({ logger, disableRequestLogging: true });
  const requireAuth = makeRequireAuth(db, identity);

  app.addHook("onResponse", (req, reply, done) => {
    req.log.info({
      event: "request.completed",
      method: req.method,
      url: req.url,
      statusCode: reply.statusCode,
      durationMs: reply.elapsedTime,
    });
    done();
  });

  app.get("/health", async () => {
    await db.execute(sql`select 1`);
    return { status: "ok" };
  });

  registerAuthRoutes(app, db);
  registerCommandRoutes(app, db, requireAuth);
  registerAssetReadRoutes(app, db, requireAuth);
  if (storage) registerArtifactRoutes(app, db, storage, requireAuth);
  app.get("/v1/me", { preHandler: requireAuth }, async (req) => req.auth);
  app.get("/v1/commands", { preHandler: requireAuth }, async () => ({
    commands: listCommands(),
  }));

  return app;
}

const isMain = process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js");
if (isMain) {
  const { initSentry } = await import("./observability/sentry.js");
  initSentry();
  const { db } = await import("./db/client.js");
  const app = buildServer({ db });
  const port = Number(process.env["PORT"] ?? 3001);
  app.listen({ port, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
