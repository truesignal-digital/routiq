import "dotenv/config";
import Fastify from "fastify";
import { listCommands } from "./commands/dispatcher.js";

export function buildServer() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/v1/commands", async () => ({ commands: listCommands() }));

  return app;
}

const isMain = process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js");
if (isMain) {
  const app = buildServer();
  const port = Number(process.env["PORT"] ?? 3001);
  app.listen({ port, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
