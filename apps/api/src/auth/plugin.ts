import type { AuthErrorCode } from "@asset/contracts";
import { loginRequest } from "@asset/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveAuthContext } from "./context.js";
import { loginWithPin } from "./local.js";
import type { AuthContext, IdentityProvider } from "./types.js";
import type { Db } from "../db/client.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

function unauthorized(reply: FastifyReply, code: AuthErrorCode) {
  return reply.status(401).send({ error: { code } });
}

export function makeRequireAuth(db: Db, identity: IdentityProvider) {
  return async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return unauthorized(reply, "AUTH_REQUIRED");

    const verified = await identity.verifyToken(header.slice("Bearer ".length));
    if (!verified) return unauthorized(reply, "AUTH_INVALID_TOKEN");

    const ctx = await resolveAuthContext(db, verified);
    if (!ctx) return unauthorized(reply, "AUTH_INVALID_TOKEN");
    req.auth = ctx;
  };
}

export function registerAuthRoutes(app: FastifyInstance, db: Db) {
  app.post("/v1/auth/login", async (req, reply) => {
    const parsed = loginRequest.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });

    const session = await loginWithPin(db, parsed.data);
    if (!session) return unauthorized(reply, "AUTH_INVALID_CREDENTIALS");
    return { token: session.token, expiresAt: session.expiresAt.toISOString() };
  });
}
