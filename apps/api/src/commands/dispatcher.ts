import {
  commandEnvelope,
  type CommandEnvelope,
  type CommandErrorCode,
  type Role,
  type ValidationErrorCode,
} from "@asset/contracts";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AuthContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import { auditEvents, commands } from "../db/schema.js";
import { isModuleEnabled, moduleOwningCommand } from "../modules/registry.js";
import { evaluateApproval, type ApprovalContext } from "./approvals.js";

export type CommandContext = AuthContext;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface CommandOutcome {
  commandId: string;
  recordId: string;
  rowVersion: number;
  warnings: string[];
  idempotentReplay: boolean;
}

export class CommandError extends Error {
  readonly httpStatus: number;
  readonly code: CommandErrorCode | ValidationErrorCode;
  readonly metadata: Record<string, unknown> | undefined;

  constructor(
    httpStatus: number,
    code: CommandErrorCode | ValidationErrorCode,
    metadata?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "CommandError";
    this.httpStatus = httpStatus;
    this.code = code;
    this.metadata = metadata;
  }
}

export interface CommandDefinition<P> {
  name: string;
  version: number;
  allowedRoles: readonly Role[];
  payloadSchema: z.ZodType<P>;
  /** Filter values approval rules may match on (branch, category, amount). */
  approvalContext?(payload: P): ApprovalContext;
  execute(
    tx: Tx,
    ctx: CommandContext,
    envelope: CommandEnvelope,
    payload: P,
  ): Promise<{ recordId: string; rowVersion: number }>;
}

export interface AuditEventInput {
  eventType: string;
  entityType: string;
  entityId: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  changedFields?: string[];
}

const commandRequest = z.strictObject({
  name: z.string().min(1),
  version: z.number().int().positive(),
  envelope: commandEnvelope,
  payload: z.json(),
});

const registry = new Map<string, CommandDefinition<unknown>>();

export function registerCommand<P>(def: CommandDefinition<P>): void {
  const key = commandKey(def.name, def.version);
  if (registry.has(key)) throw new Error(`duplicate command registration: ${key}`);
  registry.set(key, def as CommandDefinition<unknown>);
}

export function resolveCommand(name: string, version: number): CommandDefinition<unknown> {
  const def = registry.get(commandKey(name, version));
  if (!def) {
    throw new CommandError(404, "COMMAND_NOT_FOUND", { name, version });
  }
  return def;
}

export function listCommands(): string[] {
  return [...registry.keys()].sort();
}

export async function appendAuditEvent(
  tx: Tx,
  ctx: CommandContext,
  envelope: CommandEnvelope,
  event: AuditEventInput,
): Promise<void> {
  await tx.insert(auditEvents).values({
    workspaceId: ctx.workspaceId,
    commandId: envelope.commandId,
    eventType: event.eventType,
    actorPrincipalId: ctx.principalId,
    entityType: event.entityType,
    entityId: event.entityId,
    beforeState: event.beforeState ?? null,
    afterState: event.afterState ?? null,
    changedFields: event.changedFields ?? null,
  });
}

export async function dispatchCommand(
  db: Db,
  ctx: CommandContext,
  body: unknown,
  log?: { error: (obj: object) => void },
): Promise<{ status: number; body: CommandOutcome | ErrorBody }> {
  const outer = commandRequest.safeParse(body);
  if (!outer.success) {
    return commandErrorResponse(
      new CommandError(400, "VALIDATION_FAILED", {
        issues: outer.error.issues.map((issue) => ({ code: issue.code, path: issue.path })),
      }),
    );
  }

  try {
    const definition = resolveCommand(outer.data.name, outer.data.version);
    if (!definition.allowedRoles.includes(ctx.role)) {
      throw new CommandError(403, "ROLE_FORBIDDEN", {
        command: commandKey(outer.data.name, outer.data.version),
      });
    }

    const parsedPayload = definition.payloadSchema.safeParse(outer.data.payload);
    if (!parsedPayload.success) {
      throw new CommandError(400, "VALIDATION_FAILED", {
        issues: parsedPayload.error.issues.map((issue) => ({
          code: issue.code,
          path: issue.path,
        })),
      });
    }

    try {
      return await db.transaction(async (tx) => {
        // Pool-safe RLS context (§4.4 layer 2): scoped to this transaction only.
        await tx.execute(
          sql`select set_config('app.workspace_id', ${ctx.workspaceId}, true)`,
        );

        const owningModule = moduleOwningCommand(outer.data.name);
        if (owningModule && !(await isModuleEnabled(tx, ctx.workspaceId, owningModule))) {
          throw new CommandError(403, "MODULE_DISABLED", { module: owningModule });
        }

        const existing = await findReceipt(
          tx,
          ctx.workspaceId,
          outer.data.envelope.idempotencyKey,
        );
        if (existing) {
          return replayOrConflict(existing, outer.data.name, outer.data.version, outer.data.payload);
        }

        const approval = await evaluateApproval(
          tx,
          ctx,
          outer.data.envelope,
          outer.data.name,
          definition.approvalContext?.(parsedPayload.data) ?? {},
        );

        // The receipt is staged first because domain and audit rows reference its command id.
        await tx.insert(commands).values({
          id: outer.data.envelope.commandId,
          workspaceId: ctx.workspaceId,
          commandType: outer.data.name,
          commandVersion: String(outer.data.version),
          origin: outer.data.envelope.origin,
          status: "EXECUTED",
          initiatedByPrincipalId: ctx.principalId,
          idempotencyKey: outer.data.envelope.idempotencyKey,
          clientOccurredAt: outer.data.envelope.clientOccurredAt
            ? new Date(outer.data.envelope.clientOccurredAt)
            : null,
          payload: outer.data.payload,
          result: null,
          approvalOutcome: approval.outcome,
          approvalRuleId: approval.ruleId,
        });

        const result = await definition.execute(
          tx,
          ctx,
          outer.data.envelope,
          parsedPayload.data,
        );
        const outcome: CommandOutcome = {
          commandId: outer.data.envelope.commandId,
          recordId: result.recordId,
          rowVersion: result.rowVersion,
          warnings: [],
          idempotentReplay: false,
        };

        await tx.update(commands).set({ result: outcome }).where(eq(commands.id, outcome.commandId));

        return { status: 200, body: outcome };
      });
    } catch (error) {
      if (uniqueViolation(error)?.constraint === "commands_ws_idem_uq") {
        const existing = await findReceipt(
          db,
          ctx.workspaceId,
          outer.data.envelope.idempotencyKey,
        );
        if (existing) {
          return replayOrConflict(existing, outer.data.name, outer.data.version, outer.data.payload);
        }
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof CommandError) return commandErrorResponse(error);
    const violation = uniqueViolation(error);
    if (violation) {
      return commandErrorResponse(
        new CommandError(
          409,
          violation.constraint === "assets_ws_code_uq"
            ? "DUPLICATE_ASSET_CODE"
            : "UNIQUE_CONSTRAINT_VIOLATION",
          {
            ...(violation.constraint === undefined ? {} : { constraint: violation.constraint }),
          },
        ),
      );
    }
    log?.error({ err: error, event: "command.failed" });
    return commandErrorResponse(new CommandError(500, "COMMAND_FAILED"));
  }
}

interface ReceiptStore {
  select: Tx["select"];
}

interface StoredReceipt {
  commandType: string;
  commandVersion: string;
  payload: unknown;
  result: unknown;
}

interface ErrorBody {
  error: {
    code: CommandErrorCode | ValidationErrorCode;
    metadata?: Record<string, unknown>;
  };
}

function commandKey(name: string, version: number): string {
  return `${name}.v${version}`;
}

async function findReceipt(
  store: ReceiptStore,
  workspaceId: string,
  idempotencyKey: string,
): Promise<StoredReceipt | undefined> {
  const [receipt] = await store
    .select({
      commandType: commands.commandType,
      commandVersion: commands.commandVersion,
      payload: commands.payload,
      result: commands.result,
    })
    .from(commands)
    .where(and(eq(commands.workspaceId, workspaceId), eq(commands.idempotencyKey, idempotencyKey)))
    .limit(1);
  return receipt;
}

function replayOrConflict(
  receipt: StoredReceipt,
  name: string,
  version: number,
  payload: unknown,
): { status: number; body: CommandOutcome | ErrorBody } {
  const isExactRetry =
    receipt.commandType === name &&
    receipt.commandVersion === String(version) &&
    canonicalJson(receipt.payload) === canonicalJson(payload);

  if (!isExactRetry) {
    throw new CommandError(409, "IDEMPOTENCY_KEY_REUSED", {
      idempotencyKeyReused: true,
    });
  }
  if (!isCommandOutcome(receipt.result)) {
    throw new CommandError(500, "COMMAND_FAILED");
  }
  return { status: 200, body: { ...receipt.result, idempotentReplay: true } };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter((entry) => entry[1] !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, canonicalize(entryValue)]),
    );
  }
  return value;
}

function isCommandOutcome(value: unknown): value is CommandOutcome {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["commandId"] === "string" &&
    typeof candidate["recordId"] === "string" &&
    typeof candidate["rowVersion"] === "number" &&
    Array.isArray(candidate["warnings"]) &&
    typeof candidate["idempotentReplay"] === "boolean"
  );
}

function commandErrorResponse(error: CommandError): { status: number; body: ErrorBody } {
  return {
    status: error.httpStatus,
    body: {
      error: {
        code: error.code,
        ...(error.metadata === undefined ? {} : { metadata: error.metadata }),
      },
    },
  };
}

/** Unwraps to the pg unique-violation error, or null. Drizzle can wrap driver errors in `cause`. */
function uniqueViolation(error: unknown): { constraint?: string } | null {
  if (error === null || typeof error !== "object") return null;
  if ("code" in error && error.code === "23505") return error as { constraint?: string };
  if ("cause" in error) return uniqueViolation((error as { cause?: unknown }).cause);
  return null;
}
