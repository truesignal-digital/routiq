import { ROLES, type ApiErrorCode, type ModuleCode, type Role } from "@routiq/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RequireAuth } from "../auth/plugin.js";
import type { AuthContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import { inWorkspaceRead, type TenantTx } from "../db/tenant.js";
import { isModuleEnabled } from "../modules/registry.js";

export type ReadTx = TenantTx;

/**
 * What a read route must declare before it can exist, the read-side twin of
 * CommandDefinition's module, allowedRoles and branchAuthorization. Reads that
 * decided these in their handlers forgot them (#40, #58, #59).
 */
export interface ReadGate {
  module: ModuleCode;
  roles: readonly Role[];
  /**
   * "workspace": the data belongs to no branch (periods, categories).
   * "per-record": the handler filters rows by `auth.branchScope`, and a detail
   * read answers 404 outside it, exactly like a record that does not exist.
   */
  branchScope: "workspace" | "per-record";
}

export const ANY_ROLE: readonly Role[] = ROLES;

declare module "fastify" {
  interface FastifyContextConfig {
    readGate?: ReadGate;
  }
}

/** Thrown inside a read handler to answer with a stable error code. */
export class ReadError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    readonly metadata?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "ReadError";
  }
}

export interface ReadContext {
  req: FastifyRequest;
  reply: FastifyReply;
  auth: AuthContext;
  /** Runs inside the caller's workspace, in a READ ONLY transaction. */
  read<T>(execute: (tx: ReadTx) => Promise<T>): Promise<T>;
}

/**
 * Registers a GET route behind its gate. Order matters: the role check comes
 * before the module check, so a role that may not read a module learns
 * nothing about the module's state (#16).
 */
export function defineRead(
  app: FastifyInstance,
  deps: { db: Db; requireAuth: RequireAuth },
  route: ReadGate & { path: string },
  handler: (ctx: ReadContext) => Promise<unknown>,
): void {
  const { path, ...gate } = route;
  app.get(path, { preHandler: deps.requireAuth, config: { readGate: gate } }, async (req, reply) => {
    const auth = req.auth;
    if (auth === undefined) return reply.status(401).send({ error: { code: "AUTH_REQUIRED" } });
    if (!gate.roles.includes(auth.role)) {
      return reply.status(403).send({ error: { code: "ROLE_FORBIDDEN" } });
    }
    const read = <T>(execute: (tx: ReadTx) => Promise<T>) =>
      inWorkspaceRead(deps.db, auth.workspaceId, execute);
    if (!(await read((tx) => isModuleEnabled(tx, auth.workspaceId, gate.module)))) {
      return reply.status(403).send({ error: { code: "MODULE_DISABLED", metadata: { module: gate.module } } });
    }
    try {
      return await handler({ req, reply, auth, read });
    } catch (error) {
      if (!(error instanceof ReadError)) throw error;
      return reply.status(error.status).send({
        error: { code: error.code, ...(error.metadata === undefined ? {} : { metadata: error.metadata }) },
      });
    }
  });
}

/**
 * GET routes still registered without a gate. The next step of the read-gate
 * work moves them onto defineRead and empties this set; add nothing to it.
 */
export const UNGATED_READS: ReadonlySet<string> = new Set([
  "/v1/me",
  "/v1/commands",
  "/v1/artifacts/:id/download-url",
  "/v1/history/:entityType/:entityId",
  "/v1/history/:entityType/:entityId/:eventId",
  "/v1/reference/asset-registration",
  "/v1/assets",
  "/v1/assets/summary",
  "/v1/assets/:assetId",
  "/v1/categories",
  "/v1/members",
  "/v1/branches",
  "/v1/activities",
  "/v1/activities/:activityId",
  "/v1/persons",
  "/v1/places",
]);

/** Fails the boot when a /v1 GET route skips defineRead, so an ungated read cannot ship. */
export function requireReadGates(app: FastifyInstance): void {
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (!methods.includes("GET") || !route.url.startsWith("/v1/")) return;
    if (route.config?.readGate !== undefined || UNGATED_READS.has(route.url)) return;
    throw new Error(
      `GET ${route.url} has no read gate. Register it with defineRead (apps/api/src/reads/define-read.ts).`,
    );
  });
}
