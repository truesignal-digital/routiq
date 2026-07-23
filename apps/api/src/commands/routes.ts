import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";
import type { Db } from "../db/client.js";
import { dispatchCommand } from "./dispatcher.js";

export function registerCommandRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: preHandlerHookHandler,
): void {
  app.post("/v1/commands", { preHandler: requireAuth }, async (req, reply) => {
    const commandId = extractCommandId(req.body);
    req.log = req.log.child({
      ...(commandId === undefined ? {} : { commandId }),
      ...(req.auth === undefined ? {} : { workspaceId: req.auth.workspaceId }),
    });

    if (!req.auth) return unauthorized(reply);

    const result = await dispatchCommand(db, req.auth, req.body, req.log);
    return reply.status(result.status).send(result.body);
  });
}

function extractCommandId(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const envelope = (body as Record<string, unknown>)["envelope"];
  if (envelope === null || typeof envelope !== "object") return undefined;
  const commandId = (envelope as Record<string, unknown>)["commandId"];
  return typeof commandId === "string" ? commandId : undefined;
}

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({ error: { code: "AUTH_REQUIRED" } });
}
