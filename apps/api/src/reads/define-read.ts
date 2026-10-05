import { FINANCE_READER_ROLES, MEMBER_ADMIN_ROLES, ROLES, type ModuleCode, type Role } from "@routiq/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RequireAuth } from "../auth/plugin.js";
import type { AuthContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import { inWorkspaceRead, type TenantTx } from "../db/tenant.js";
import { passReadGate, sendReadFailure, type ReadGate } from "./read-gate.js";

export type { ReadGate } from "./read-gate.js";
export type ReadTx = TenantTx;

export const ANY_ROLE: readonly Role[] = ROLES;

/**
 * Administrative reads: members and branch settings are facts for the people
 * who manage access (DIRECTOR, and ADMIN for their branches' field roles), not
 * directory data. Interim: the read-gates slice narrows what an ADMIN sees.
 */
export const ADMINISTRATORS: readonly Role[] = MEMBER_ADMIN_ROLES;

/** The books: the ledger-reading roles, and FINANCE on. */
export const LEDGER_GATE = {
  module: "FINANCE",
  roles: FINANCE_READER_ROLES,
} as const satisfies Pick<ReadGate, "module" | "roles">;

declare module "fastify" {
  interface FastifyContextConfig {
    readGate?: ReadGate;
  }
}

export interface ReadContext {
  req: FastifyRequest;
  reply: FastifyReply;
  auth: AuthContext;
  /** The workspace's enabled modules, as the gate found them. */
  modules: ReadonlySet<ModuleCode>;
  /** Runs inside the caller's workspace, in a READ ONLY transaction. */
  read<T>(execute: (tx: ReadTx) => Promise<T>): Promise<T>;
}

/**
 * Registers a GET route behind its gate (`passReadGate`: role, then module).
 * A `ReadRefusal` thrown from the handler answers with its code; anything
 * else is 500 READ_FAILED.
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
    const read = <T>(execute: (tx: ReadTx) => Promise<T>) =>
      inWorkspaceRead(deps.db, auth.workspaceId, execute);
    try {
      const modules = await read((tx) => passReadGate(tx, auth, gate));
      return await handler({ req, reply, auth, modules, read });
    } catch (error) {
      return sendReadFailure(req, reply, error, `GET ${path}`);
    }
  });
}

/**
 * GET routes allowed to skip defineRead. Empty since every read moved onto it
 * (#58, #59); keep it empty. A new read declares its gate instead.
 */
export const UNGATED_READS: ReadonlySet<string> = new Set<string>([]);

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
