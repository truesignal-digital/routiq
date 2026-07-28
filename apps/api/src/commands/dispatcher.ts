import {
  commandEnvelope,
  type CommandEnvelope,
  type CommandErrorCode,
  type CommandWarningCode,
  type ModuleCode,
  type Role,
  type ValidationErrorCode,
} from "@routiq/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { AuthContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import { inWorkspace, type TenantTx } from "../db/tenant.js";
import {
  assets,
  auditEvents,
  commands,
  commandSourceArtifacts,
  sourceArtifacts,
} from "../db/schema.js";
import { isModuleEnabled } from "../modules/registry.js";
import { reportUnexpectedFailure } from "../observability/sentry.js";
import {
  evaluateApproval,
  type ApprovalContext,
  type ApprovalDecision,
} from "./approvals.js";

export type CommandContext = AuthContext;
export type Tx = TenantTx;

/**
 * Per-child state a composite command's caller cannot infer. Every nested id is
 * client-generated, so the client already knows what it created — what it cannot
 * know is which embedded expense cleared the threshold and which is waiting. An
 * offline outbox has to render "2 lignes en attente d'approbation" from the
 * response it queued, with no round trip.
 */
export interface CommandOutcomeChild {
  entityType: "financial_entry";
  id: string;
  status: string;
  warnings: CommandWarningCode[];
}

export interface CommandOutcome {
  commandId: string;
  recordId: string;
  rowVersion: number;
  /** Post-command record state where it matters (POSTED vs SUBMITTED entries). */
  recordStatus?: string;
  warnings: CommandWarningCode[];
  /** Composite commands only; absent for the single-record majority. */
  children?: CommandOutcomeChild[];
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

/**
 * Adding a command:
 *   1. Payload schema in packages/contracts/src/commands/<name>.ts (+ test).
 *   2. A CommandDefinition like this one, registered via registerCommand and
 *      side-effect imported in server.ts. `module` declares ownership — commands
 *      of a disabled module are rejected MODULE_DISABLED; CORE is always on.
 *   3. A catalog default in approval-defaults.ts — without one every call is
 *      rejected APPROVAL_REQUIRED (registry.test.ts enforces this).
 *   4. New tables need explicit GRANTs to routiq_app in their migration
 *      (db/grants.test.ts enforces this).
 * The dispatcher supplies auth, module check, idempotency, approval evaluation,
 * receipt, audit atomicity; execute() owns only references, invariants, writes.
 */
export interface CommandDefinition<P> {
  name: string;
  version: number;
  module: ModuleCode;
  allowedRoles: readonly Role[];
  payloadSchema: z.ZodType<P>;
  /**
   * Declares which asset the command writes operational records against. The
   * dispatcher rejects SOLD/RETIRED/WRITTEN_OFF assets (§3.4) before any
   * handler code runs — handlers never re-implement this invariant.
   */
  operationalAssetId?(payload: P): string | undefined;
  /**
   * Every command explicitly declares its branch impact. Requiring a policy
   * keeps new commands fail-closed instead of silently skipping branch scope.
   */
  branchAuthorization:
    | { kind: "workspace" }
    | {
        kind: "branches";
        resolve(
          tx: Tx,
          ctx: CommandContext,
          payload: P,
        ): Promise<readonly string[]>;
      };
  /** Filter values approval rules may match on (branch, category, amount). May read via tx. */
  approvalContext?(tx: Tx, ctx: CommandContext, payload: P): Promise<ApprovalContext>;
  /**
   * What APPROVAL_REQUIRED means for this command. Default 'REJECT': the call
   * fails 403 and nothing commits. 'SUBMIT' (financial entries, §5.2): the
   * command proceeds and the handler must store the record in a SUBMITTED
   * state, to be decided later by an approve/reject command.
   */
  approvalMode?: "REJECT" | "SUBMIT";
  execute(
    tx: Tx,
    ctx: CommandContext,
    envelope: CommandEnvelope,
    payload: P,
    approval: ApprovalDecision,
  ): Promise<{
    recordId: string;
    rowVersion: number;
    recordStatus?: string;
    warnings?: CommandWarningCode[];
    children?: CommandOutcomeChild[];
  }>;
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
  if (!def.branchAuthorization) {
    throw new Error(`command branch authorization missing: ${key}`);
  }
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
      return await inWorkspace(db, ctx.workspaceId, async (tx) => {
        const authorizedBranchIds =
          definition.branchAuthorization.kind === "branches"
            ? await definition.branchAuthorization.resolve(
                tx,
                ctx,
                parsedPayload.data,
              )
            : [];
        if (
          ctx.branchScope !== "ALL" &&
          authorizedBranchIds.some(
            (branchId) => !ctx.branchScope.includes(branchId),
          )
        ) {
          throw new CommandError(403, "ROLE_FORBIDDEN", {
            command: commandKey(outer.data.name, outer.data.version),
          });
        }

        if (!(await isModuleEnabled(tx, ctx.workspaceId, definition.module))) {
          throw new CommandError(403, "MODULE_DISABLED", { module: definition.module });
        }

        const existing = await findReceipt(
          tx,
          ctx.workspaceId,
          outer.data.envelope.idempotencyKey,
        );
        if (existing) {
          return replayOrConflict(existing, outer.data.name, outer.data.version, outer.data.payload);
        }

        const targetAssetId = definition.operationalAssetId?.(parsedPayload.data);
        if (targetAssetId !== undefined) {
          const [target] = await tx
            .select({ lifecycleStatus: assets.lifecycleStatus })
            .from(assets)
            .where(and(eq(assets.workspaceId, ctx.workspaceId), eq(assets.id, targetAssetId)));
          // Missing asset falls through to the handler's REFERENCE_NOT_FOUND with context.
          if (
            target &&
            ["SOLD", "RETIRED", "WRITTEN_OFF"].includes(target.lifecycleStatus)
          ) {
            throw new CommandError(409, "ASSET_NOT_OPERATIONAL", {
              assetId: targetAssetId,
              lifecycleStatus: target.lifecycleStatus,
            });
          }
        }

        const approval = await evaluateApproval(
          tx,
          ctx,
          outer.data.envelope,
          outer.data.name,
          (await definition.approvalContext?.(tx, ctx, parsedPayload.data)) ?? {},
        );
        if (approval.outcome === "APPROVAL_REQUIRED" && definition.approvalMode !== "SUBMIT") {
          throw new CommandError(403, "APPROVAL_REQUIRED", { commandType: outer.data.name });
        }

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

        await linkSourceArtifacts(tx, ctx, outer.data.envelope);

        const result = await definition.execute(
          tx,
          ctx,
          outer.data.envelope,
          parsedPayload.data,
          approval,
        );
        const outcome: CommandOutcome = {
          commandId: outer.data.envelope.commandId,
          recordId: result.recordId,
          rowVersion: result.rowVersion,
          ...(result.recordStatus === undefined ? {} : { recordStatus: result.recordStatus }),
          warnings: result.warnings ?? [],
          ...(result.children === undefined ? {} : { children: result.children }),
          idempotentReplay: false,
        };

        await tx.update(commands).set({ result: outcome }).where(eq(commands.id, outcome.commandId));

        return { status: 200, body: outcome };
      });
    } catch (error) {
      if (uniqueViolation(error)?.constraint === "commands_ws_idem_uq") {
        const existing = await inWorkspace(
          db,
          ctx.workspaceId,
          (tx) => findReceipt(
            tx,
            ctx.workspaceId,
            outer.data.envelope.idempotencyKey,
          ),
        );
        if (existing) {
          return replayOrConflict(existing, outer.data.name, outer.data.version, outer.data.payload);
        }
      }
      throw error;
    }
  } catch (error) {
    let commandError: CommandError;
    if (error instanceof CommandError) {
      commandError = error;
    } else {
      const violation = uniqueViolation(error);
      if (violation) {
        commandError = new CommandError(
          409,
          violation.constraint === "assets_ws_code_uq"
            ? "DUPLICATE_ASSET_CODE"
            : "UNIQUE_CONSTRAINT_VIOLATION",
          {
            ...(violation.constraint === undefined ? {} : { constraint: violation.constraint }),
          },
        );
      } else {
        log?.error({ err: error, event: "command.failed" });
        reportUnexpectedFailure(error, {
          commandId: outer.data.envelope.commandId,
          workspaceId: ctx.workspaceId,
          commandType: outer.data.name,
          origin: outer.data.envelope.origin,
        });
        commandError = new CommandError(500, "COMMAND_FAILED");
      }
    }
    await recordFailureReceipt(db, ctx, outer.data, commandError, log);
    return commandErrorResponse(commandError);
  }
}

/**
 * Offline-replay debugging trail (financial-core 01): failed commands leave a
 * REJECTED (business rejection) or FAILED (unexpected) receipt in their own
 * transaction after the original one rolled back. These rows never consume the
 * idempotency key — the unique index is partial on EXECUTED — so a retry with
 * the same key/commandId re-evaluates against current state. Receipt-write
 * failure must never mask the original error.
 */
async function recordFailureReceipt(
  db: Db,
  ctx: CommandContext,
  request: { name: string; version: number; envelope: CommandEnvelope; payload: unknown },
  commandError: CommandError,
  log?: { error: (obj: object) => void },
): Promise<void> {
  try {
    await inWorkspace(db, ctx.workspaceId, async (tx) => {
      await tx.insert(commands).values({
        id: crypto.randomUUID(),
        clientCommandId: request.envelope.commandId,
        workspaceId: ctx.workspaceId,
        commandType: request.name,
        commandVersion: String(request.version),
        origin: request.envelope.origin,
        status: commandError.httpStatus >= 500 ? "FAILED" : "REJECTED",
        initiatedByPrincipalId: ctx.principalId,
        idempotencyKey: request.envelope.idempotencyKey,
        clientOccurredAt: request.envelope.clientOccurredAt
          ? new Date(request.envelope.clientOccurredAt)
          : null,
        payload: request.payload,
        result: null,
        failureCode: commandError.code,
      });
    });
  } catch (receiptError) {
    log?.error({ err: receiptError, event: "command.failure_receipt_failed" });
  }
}

/** §5.3 optimistic concurrency: mutations of existing rows must carry expectedVersion. */
export function checkOptimisticVersion(envelope: CommandEnvelope, currentVersion: number): void {
  if (envelope.expectedVersion === undefined) {
    throw new CommandError(400, "EXPECTED_VERSION_REQUIRED");
  }
  if (envelope.expectedVersion !== currentVersion) {
    throw new CommandError(409, "VERSION_CONFLICT", {
      expectedVersion: envelope.expectedVersion,
      currentVersion,
    });
  }
}

async function linkSourceArtifacts(
  tx: Tx,
  ctx: CommandContext,
  envelope: CommandEnvelope,
): Promise<void> {
  if (envelope.sourceArtifactIds.length === 0) return;
  const rows = await tx
    .select({ id: sourceArtifacts.id })
    .from(sourceArtifacts)
    .where(
      and(
        eq(sourceArtifacts.workspaceId, ctx.workspaceId),
        inArray(sourceArtifacts.id, envelope.sourceArtifactIds),
      ),
    );
  const found = new Set(rows.map((r) => r.id));
  const missing = envelope.sourceArtifactIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "sourceArtifact",
      missing,
    });
  }
  await tx.insert(commandSourceArtifacts).values(
    envelope.sourceArtifactIds.map((artifactId) => ({
      workspaceId: ctx.workspaceId,
      commandId: envelope.commandId,
      artifactId,
    })),
  );
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
    .where(
      and(
        eq(commands.workspaceId, workspaceId),
        eq(commands.idempotencyKey, idempotencyKey),
        // REJECTED/FAILED receipts are a debugging trail, not idempotency
        // participants: only success consumes the key (partial unique index).
        eq(commands.status, "EXECUTED"),
      ),
    )
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
    (candidate["recordStatus"] === undefined || typeof candidate["recordStatus"] === "string") &&
    Array.isArray(candidate["warnings"]) &&
    // A stored sheet receipt must round-trip its children, or replaying one
    // would fail this guard and return 500 instead of the original result.
    (candidate["children"] === undefined || Array.isArray(candidate["children"])) &&
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
