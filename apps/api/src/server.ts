import "dotenv/config";
import { sql } from "drizzle-orm";
import Fastify from "fastify";
import { listCommands } from "./commands/dispatcher.js";
import type { Db } from "./db/client.js";

export interface ServerDeps {
  db: Db;
  logger?: boolean;
}

export function buildServer({ db, logger = true }: ServerDeps) {
  const app = Fastify({ logger });

  app.get("/health", async () => {
    await db.execute(sql`select 1`);
    return { status: "ok" };
  });
  app.get("/v1/commands", async () => ({ commands: listCommands() }));

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
