import { MODULE_CODES, type ModuleCode, type Role } from "@routiq/contracts";
import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthContext } from "../auth/types.js";
import { workspaceModules } from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";

type RefusalCode =
  | "VALIDATION_FAILED"
  | "ROLE_FORBIDDEN"
  | "MODULE_DISABLED"
  | "REFERENCE_NOT_FOUND";

/**
 * A read that answers with a stable error code instead of data. Thrown from
 * inside `inWorkspace` so a refusal found three queries deep needs no plumbing;
 * the transaction only read, so rolling it back costs nothing.
 */
export class ReadRefusal extends Error {
  constructor(
    readonly status: 400 | 403 | 404,
    readonly code: RefusalCode,
    readonly metadata?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "ReadRefusal";
  }

  body(): { error: { code: RefusalCode; metadata?: Record<string, unknown> } } {
    return {
      error: {
        code: this.code,
        ...(this.metadata === undefined ? {} : { metadata: this.metadata }),
      },
    };
  }
}

export const notFound = (): ReadRefusal => new ReadRefusal(404, "REFERENCE_NOT_FOUND");
export const invalidRequest = (): ReadRefusal => new ReadRefusal(400, "VALIDATION_FAILED");

/**
 * Enabled modules in one query, by the same rule as `isModuleEnabled`: no row
 * means enabled, and CORE is always on. A read that gates several sections
 * (availability, readings, money) asks once instead of once per section.
 */
export async function enabledModuleSet(
  tx: TenantTx,
  workspaceId: string,
): Promise<ReadonlySet<ModuleCode>> {
  const rows = await tx
    .select({ moduleCode: workspaceModules.moduleCode, enabled: workspaceModules.enabled })
    .from(workspaceModules)
    .where(eq(workspaceModules.workspaceId, workspaceId));
  const disabled = new Set(rows.filter((row) => !row.enabled).map((row) => row.moduleCode));
  return new Set(MODULE_CODES.filter((code) => code === "CORE" || !disabled.has(code)));
}

/**
 * What a read route must declare before it can exist, the read-side twin of
 * CommandDefinition's module, allowedRoles and branchAuthorization. Reads that
 * decided these in their handlers forgot them (#40, #58, #59). Routes declare
 * it through `defineRead` (define-read.ts), the only way a /v1 GET registers.
 */
export interface ReadGate {
  /** The module that owns the read; off means 403 MODULE_DISABLED. */
  module: ModuleCode;
  /** Roles allowed to read at all; anyone else gets 403 ROLE_FORBIDDEN. */
  roles: readonly Role[];
  /**
   * "workspace": the data belongs to no branch (periods, categories).
   * "per-record": the handler filters rows by `auth.branchScope`, and a detail
   * read answers 404 outside it, exactly like a record that does not exist.
   */
  branchScope: "workspace" | "per-record";
}

/**
 * The caller's role, then the owning module: a role that may not read a
 * module learns nothing about the module's state (#16). Returns the enabled
 * modules so a read can drop the sections of other modules without asking
 * again.
 */
export async function passReadGate(
  tx: TenantTx,
  auth: AuthContext,
  gate: Pick<ReadGate, "module" | "roles">,
): Promise<ReadonlySet<ModuleCode>> {
  if (!gate.roles.includes(auth.role)) {
    throw new ReadRefusal(403, "ROLE_FORBIDDEN");
  }
  const modules = await enabledModuleSet(tx, auth.workspaceId);
  if (!modules.has(gate.module)) {
    throw new ReadRefusal(403, "MODULE_DISABLED", { module: gate.module });
  }
  return modules;
}

/** Maps a refusal to its response and anything else to 500 READ_FAILED. */
export function sendReadFailure(
  req: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
  what: string,
) {
  if (error instanceof ReadRefusal) {
    return reply.status(error.status).send(error.body());
  }
  req.log.error({ err: error }, `${what} read failed`);
  return reply.status(500).send({ error: { code: "READ_FAILED" } });
}
