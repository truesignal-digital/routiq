import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";
import type { Db } from "../db/client.js";
import { dispatchCommand } from "./dispatcher.js";

export function registerCommandRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: preHandlerHookHandler,
): void {
  app.post("/v1/commands", { preHandler: requireAuth }, (req, reply) =>
    handleCommand(db, req, reply, req.body),
  );
  app.post(
    "/v1/commands/:name",
    { preHandler: requireAuth },
    (req, reply) => {
      const { name } = req.params as { name: string };
      return handleCommand(db, req, reply, namedCommandBody(name, req.body));
    },
  );
}

async function handleCommand(
  db: Db,
  req: FastifyRequest,
  reply: FastifyReply,
  body: unknown,
) {
  const commandId = extractCommandId(body);
  req.log = req.log.child({
    ...(commandId === undefined ? {} : { commandId }),
    ...(req.auth === undefined ? {} : { workspaceId: req.auth.workspaceId }),
  });

  if (!req.auth) return unauthorized(reply);

  const result = await dispatchCommand(db, req.auth, body, req.log);
  return reply.status(result.status).send(result.body);
}

function namedCommandBody(name: string, body: unknown): unknown {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { name };
  }
  return { ...(body as Record<string, unknown>), name };
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
