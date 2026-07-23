import "dotenv/config";
import { sql } from "drizzle-orm";
import Fastify from "fastify";
import { LocalSessionProvider } from "./auth/local.js";
import { makeRequireAuth, registerAuthRoutes } from "./auth/plugin.js";
import type { IdentityProvider } from "./auth/types.js";
import { listCommands } from "./commands/dispatcher.js";
import type { Db } from "./db/client.js";

export interface ServerDeps {
  db: Db;
  identity?: IdentityProvider;
  logger?: boolean;
}

export function buildServer({
  db,
  identity = new LocalSessionProvider(db),
  logger = true,
}: ServerDeps) {
  const app = Fastify({ logger });
  const requireAuth = makeRequireAuth(db, identity);

  app.get("/health", async () => {
    await db.execute(sql`select 1`);
    return { status: "ok" };
  });

  registerAuthRoutes(app, db);
  app.get("/v1/me", { preHandler: requireAuth }, async (req) => req.auth);
  app.get("/v1/commands", { preHandler: requireAuth }, async () => ({
    commands: listCommands(),
  }));

  return app;
}

const isMain = process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js");
if (isMain) {
  const { db } = await import("./db/client.js");
  const app = buildServer({ db });
  const port = Number(process.env["PORT"] ?? 3001);
  app.listen({ port, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
