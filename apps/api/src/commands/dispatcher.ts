import {
  clientAuthorityKeyPaths,
  commandEnvelope,
  type CommandEnvelope,
  type CommandErrorCode,
  type CommandWarningCode,
  type ModuleCode,
  type Role,
  type TemplateCode,
  type ValidationErrorCode,
} from "@routiq/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  isOperatorContext,
  type AuthContext,
  type CommandActorContext,
  type OperatorContext,
} from "../auth/types.js";
import type { Db } from "../db/client.js";
import { inPlatformScope, type PlatformDb } from "../db/platform.js";
import { inWorkspace, type TenantTx } from "../db/tenant.js";
import {
  assets,
  auditEvents,
  commands,
  commandSourceArtifacts,
  sourceArtifacts,
} from "../db/schema.js";
import { isModuleEnabled } from "../modules/registry.js";
import { presetEnablement } from "../templates/registry.js";
import { reportUnexpectedFailure } from "../observability/sentry.js";
import {
  evaluateApproval,
  type ApprovalContext,
  type ApprovalDecision,
} from "./approvals.js";
import { fingerprintCanonical } from "./payload-fingerprint.js";
import { redactSecrets } from "./redaction.js";

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

export interface CommandExecuteResult {
  recordId: string;
  rowVersion: number;
  recordStatus?: string;
  warnings?: CommandWarningCode[];
  children?: CommandOutcomeChild[];
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
 *   5. A decision command (`approve-*`, `reject-*`) declares `maker`, and gets
 *      a row in maker-checker.test.ts.
 * The dispatcher supplies auth, module check, idempotency, approval evaluation,
 * receipt, audit atomicity; execute() owns only references, invariants, writes.
 */
export interface CommandDefinition<P> {
  scope?: "workspace";
  name: string;
  version: number;
  module: ModuleCode;
  allowedRoles: readonly Role[];
  /**
   * Refuse every principal but a HUMAN, whatever its role. For decisions §5.1
   * reserves to people outright — release to service is "never AI" — so an AI
   * agent or integration granted an eligible role still cannot make them.
   */
  requiresHumanPrincipal?: true;
  payloadSchema: z.ZodType<P>;
  /**
   * Declares which asset the command writes operational records against. The
   * dispatcher rejects SOLD/RETIRED/WRITTEN_OFF assets (§3.4) before any
   * handler code runs — handlers never re-implement this invariant.
   */
  operationalAssetId?(payload: P): string | undefined;
  /**
   * Declares which template preset this call belongs to — from the payload
   * where the client picks one (register-asset, create-activity), or a constant
   * where the command IS a preset (the sheets). Checked beside the module flag
   * so preset entitlement stays one pipeline step rather than N handler copies.
   */
  presetCode?(payload: P): TemplateCode | undefined;
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
  /**
   * What the receipt stores in place of the payload, for a command whose input
   * carries a secret (`add-member`, `reset-member-pin`). Used for the stored
   * row AND the idempotency comparison, so redacting cannot turn an honest
   * retry into IDEMPOTENCY_KEY_REUSED.
   *
   * Deliberately typed over the raw JSON rather than the parsed payload, unlike
   * the platform hook: a workspace command writes a receipt on the failure path
   * too (`recordFailureReceipt`), and that path is reached with a payload the
   * schema has already rejected. A PIN in a malformed payload is still a PIN,
   * so the seam has to cover input that never parsed.
   */
  redactPayload?(payload: unknown): unknown;
  /**
   * Required on a decision command (`approve-*`, `reject-*`; registerCommand
   * enforces it): the member who made the record being decided, or undefined
   * when the record does not exist. The dispatcher refuses that member
   * MAKER_CANNOT_APPROVE before approval rules are read. Lock the record here
   * (`FOR UPDATE`) so its maker cannot change before `execute` runs.
   */
  maker?(tx: Tx, ctx: CommandContext, payload: P): Promise<string | undefined>;
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
  ): Promise<CommandExecuteResult>;
}

/**
 * Provisioning-shaped commands: no workspace exists when they start, so they
 * run for a vendor operator instead of a member, outside `inWorkspace`, on the
 * RLS-bypassing connection. Everything a workspace command inherits that still
 * has meaning without a tenant is kept — payload validation, idempotency,
 * receipt, audit, one transaction. Everything that is per-workspace *data* is
 * structurally absent rather than skipped at runtime: there is no `module`
 * flag, no `allowedRoles`, no branch scope and no approval rule to read, and
 * this type has nowhere to put them.
 */
export interface PlatformCommandDefinition<P> {
  scope: "platform";
  name: string;
  version: number;
  payloadSchema: z.ZodType<P>;
  /**
   * Returns the workspace the receipt is filed under: provisioning creates it
   * here and nothing else; a command on an existing workspace (appoint-director)
   * looks it up.
   *
   * The ordering is forced, not stylistic: `commands.workspace_id` is a real FK,
   * so the workspace must exist before the receipt — and every row `execute`
   * writes carries `created_by_command_id`, so the receipt must exist before
   * them. That leaves exactly one slot for the workspace insert, and it is here.
   */
  resolveWorkspace(
    tx: Tx,
    ctx: OperatorContext,
    envelope: CommandEnvelope,
    payload: P,
  ): Promise<string>;
  /**
   * What the receipt stores in place of the payload, for a command whose input
   * carries a secret. The dispatcher uses the returned value for BOTH the stored
   * row and the idempotency comparison — redacting only on the way in would make
   * every legitimate re-run of the same file a 409 instead of a replay.
   *
   * Workspace commands have no equivalent because none of them accepts a secret
   * today. Add one there when that stops being true, not before.
   */
  redactPayload?(payload: P): unknown;
  execute(
    tx: Tx,
    ctx: OperatorContext,
    envelope: CommandEnvelope,
    payload: P,
    workspaceId: string,
  ): Promise<CommandExecuteResult>;
}

type AnyCommandDefinition = CommandDefinition<unknown> | PlatformCommandDefinition<unknown>;

function isPlatformCommand(
  definition: AnyCommandDefinition,
): definition is PlatformCommandDefinition<unknown> {
  return definition.scope === "platform";
}

/** The slice of the request logger the pipeline uses; pino satisfies it. */
export interface CommandLog {
  error: (obj: object) => void;
  warn?: (obj: object) => void;
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

const registry = new Map<string, AnyCommandDefinition>();

export function registerCommand<P>(def: CommandDefinition<P>): void {
  const key = claimCommandKey(def.name, def.version);
  if (!def.branchAuthorization) {
    throw new Error(`command branch authorization missing: ${key}`);
  }
  if (isDecisionCommand(def.name) && !def.maker) {
    throw new Error(`decision command names no maker: ${key}`);
  }
  registry.set(key, def as CommandDefinition<unknown>);
}

/** Nobody approves a record they submitted (ADR-0009): these commands must name its maker. */
export function isDecisionCommand(name: string): boolean {
  return /^(approve|reject)-/.test(name);
}

/** Separate entry point, so a platform command cannot be declared with tenant fields. */
export function registerPlatformCommand<P>(def: PlatformCommandDefinition<P>): void {
  registry.set(
    claimCommandKey(def.name, def.version),
    def as PlatformCommandDefinition<unknown>,
  );
}

export function resolveCommand(name: string, version: number): AnyCommandDefinition {
  const def = registry.get(commandKey(name, version));
  if (!def) {
    throw new CommandError(404, "COMMAND_NOT_FOUND", { name, version });
  }
  return def;
}

export function listCommands(): string[] {
  return [...registry.keys()].sort();
}

/** Registered definitions, for convention guards that need more than the name. */
export function listCommandDefinitions(): AnyCommandDefinition[] {
  return [...registry.values()];
}

function claimCommandKey(name: string, version: number): string {
  const key = commandKey(name, version);
  if (registry.has(key)) throw new Error(`duplicate command registration: ${key}`);
  return key;
}

export async function appendAuditEvent(
  tx: Tx,
  ctx: CommandContext,
  envelope: CommandEnvelope,
  event: AuditEventInput,
): Promise<void> {
  await writeAuditEvent(tx, "WORKSPACE", ctx.workspaceId, ctx.principalId, envelope, event);
}

/** Same append-only trail, for an actor who is not a member of the workspace it lands in. */
export async function appendPlatformAuditEvent(
  tx: Tx,
  ctx: OperatorContext,
  workspaceId: string,
  envelope: CommandEnvelope,
  event: AuditEventInput,
): Promise<void> {
  await writeAuditEvent(tx, "PLATFORM", workspaceId, ctx.principalId, envelope, event);
}

async function writeAuditEvent(
  tx: Tx,
  scope: "WORKSPACE" | "PLATFORM",
  workspaceId: string,
  actorPrincipalId: string,
  envelope: CommandEnvelope,
  event: AuditEventInput,
): Promise<void> {
  await tx.insert(auditEvents).values({
    workspaceId,
    scope,
    commandId: envelope.commandId,
    eventType: event.eventType,
    actorPrincipalId,
    entityType: event.entityType,
    entityId: event.entityId,
    beforeState: event.beforeState ?? null,
    afterState: event.afterState ?? null,
    changedFields: event.changedFields ?? null,
  });
}

export function dispatchCommand(
  db: Db,
  ctx: AuthContext,
  body: unknown,
  log?: CommandLog,
): Promise<{ status: number; body: CommandOutcome | ErrorBody }>;
export function dispatchCommand(
  db: PlatformDb,
  ctx: OperatorContext,
  body: unknown,
  log?: CommandLog,
): Promise<{ status: number; body: CommandOutcome | ErrorBody }>;
/**
 * The two overloads above are the seam's real guard: a `PlatformDb` is not a
 * `Db`, so the RLS-bypassing connection cannot be paired with a tenant session,
 * nor a tenant connection with an operator. The runtime checks below cover the
 * same ground for callers that reach here untyped.
 */
export async function dispatchCommand(
  db: Db | PlatformDb,
  ctx: CommandActorContext,
  body: unknown,
  log?: CommandLog,
): Promise<{ status: number; body: CommandOutcome | ErrorBody }> {
  const started = performance.now();
  /**
   * Workspace, actor and branch scope come from `ctx` alone (#152). A request
   * that tries to name them, at any depth of its envelope or payload, is
   * refused here, before any schema runs: an open schema would strip the key
   * and carry on, and the caller would never learn its field was ignored.
   */
  const smuggled = clientAuthorityKeyPaths(body);
  if (smuggled.length > 0) {
    return commandErrorResponse(
      new CommandError(400, "VALIDATION_FAILED", {
        issues: smuggled.map((path) => ({ code: "unrecognized_keys", path })),
      }),
    );
  }
  const outer = commandRequest.safeParse(body);
  if (!outer.success) {
    return commandErrorResponse(
      new CommandError(400, "VALIDATION_FAILED", {
        issues: outer.error.issues.map((issue) => ({ code: issue.code, path: issue.path })),
      }),
    );
  }

  /**
   * What every receipt for this call stores — success, replay comparison and
   * failure trail alike.
   *
   * It starts redacted rather than raw. Resolving the command is itself a step
   * that can throw — an unknown name, an unsupported version, a platform
   * command reached through the workspace route — and each of those still
   * leaves a REJECTED receipt behind, so a payload that never reached a
   * definition must already be safe to store. A command that declares its own
   * `redactPayload` replaces this with the precise version below.
   */
  let receiptPayload: unknown = redactSecrets(outer.data.payload);

  /**
   * Fingerprint of the RAW payload, which is what decides whether a reused
   * idempotency key carries the same call again. Redaction maps every PIN to
   * one marker, so comparing stored payloads would read two resets to
   * different PINs as the same request and replay the first — reporting
   * success for a PIN it never set, and leaving an admin handing out a code
   * that does not work. The hash is taken before redaction and only the hash
   * is stored, so the receipt still holds no secret.
   */
  const payloadFingerprint = fingerprint(outer.data.payload);

  try {
    const definition = resolveCommand(outer.data.name, outer.data.version);
    const command = commandKey(outer.data.name, outer.data.version);
    if (!isPlatformCommand(definition) && definition.redactPayload) {
      receiptPayload = definition.redactPayload(outer.data.payload);
    }

    if (isPlatformCommand(definition)) {
      if (!isOperatorContext(ctx)) {
        throw new CommandError(403, "COMMAND_SCOPE_FORBIDDEN", {
          command,
          commandScope: "platform",
          actorScope: "workspace",
        });
      }
      return await dispatchPlatform(requirePlatformDb(db), ctx, definition, outer.data, started);
    }
    if (isOperatorContext(ctx)) {
      throw new CommandError(403, "COMMAND_SCOPE_FORBIDDEN", {
        command,
        commandScope: "workspace",
        actorScope: "platform",
      });
    }
    const tenantDb = requireTenantDb(db);

    if (!definition.allowedRoles.includes(ctx.role)) {
      throw new CommandError(403, "ROLE_FORBIDDEN", { command });
    }
    if (definition.requiresHumanPrincipal && ctx.principalType !== "HUMAN") {
      throw new CommandError(403, "HUMAN_PRINCIPAL_REQUIRED", {
        command,
        principalType: ctx.principalType,
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
      return await inWorkspace(tenantDb, ctx.workspaceId, async (tx) => {
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
          throw new CommandError(403, "ROLE_FORBIDDEN", { command });
        }

        if (!(await isModuleEnabled(tx, ctx.workspaceId, definition.module))) {
          throw new CommandError(403, "MODULE_DISABLED", { module: definition.module });
        }

        const presetCode = definition.presetCode?.(parsedPayload.data);
        if (presetCode !== undefined) {
          const enablement = await presetEnablement(tx, ctx.workspaceId, presetCode);
          if (enablement === "DISABLED") {
            throw new CommandError(403, "PRESET_DISABLED", { presetCode });
          }
          if (enablement === "UNCONFIGURED") {
            log?.warn?.({
              event: "preset.unenforced",
              workspaceId: ctx.workspaceId,
              presetCode,
            });
          }
        }

        const existing = await findReceipt(
          tx,
          ctx.workspaceId,
          outer.data.envelope.idempotencyKey,
        );
        if (existing) {
          return replayOrConflict(
            existing,
            outer.data.name,
            outer.data.version,
            receiptPayload,
            payloadFingerprint,
          );
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

        if (definition.maker) {
          const maker = await definition.maker(tx, ctx, parsedPayload.data);
          if (maker !== undefined && maker === ctx.principalId) {
            throw new CommandError(403, "MAKER_CANNOT_APPROVE");
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
          payload: receiptPayload,
          payloadHash: payloadFingerprint,
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

        await tx
          .update(commands)
          .set({ result: outcome, durationMs: elapsedMs(started) })
          .where(eq(commands.id, outcome.commandId));

        return { status: 200, body: outcome };
      });
    } catch (error) {
      if (uniqueViolation(error)?.constraint === "commands_ws_idem_uq") {
        const existing = await inWorkspace(
          tenantDb,
          ctx.workspaceId,
          (tx) => findReceipt(
            tx,
            ctx.workspaceId,
            outer.data.envelope.idempotencyKey,
          ),
        );
        if (existing) {
          return replayOrConflict(
            existing,
            outer.data.name,
            outer.data.version,
            receiptPayload,
            payloadFingerprint,
          );
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
        // A username collision losing the race to a concurrent add-member
        // lands here rather than on the handler's pre-check, and must still
        // answer with the code the screen renders inline.
        commandError =
          violation.constraint === "credentials_ws_username_uq"
            ? new CommandError(422, "USERNAME_TAKEN")
            : violation.constraint === "branches_ws_code_uq"
              ? new CommandError(409, "DUPLICATE_BRANCH_CODE")
            : violation.constraint === "branches_ws_name_uq"
              ? new CommandError(409, "DUPLICATE_BRANCH_NAME")
            : new CommandError(
                409,
                violation.constraint === "assets_ws_code_uq"
                  ? "DUPLICATE_ASSET_CODE"
                  : "UNIQUE_CONSTRAINT_VIOLATION",
                {
                  ...(violation.constraint === undefined
                    ? {}
                    : { constraint: violation.constraint }),
                },
              );
      } else {
        log?.error({ err: error, event: "command.failed" });
        reportUnexpectedFailure(error, {
          commandId: outer.data.envelope.commandId,
          workspaceId: isOperatorContext(ctx) ? "" : ctx.workspaceId,
          commandType: outer.data.name,
          origin: outer.data.envelope.origin,
        });
        commandError = new CommandError(500, "COMMAND_FAILED");
      }
    }
    // A failed platform command leaves no receipt: the workspace its row would
    // reference rolled back with it, and commands.workspace_id is a real FK.
    // The CLI operator sees the error directly, which is the whole audience.
    if (!isOperatorContext(ctx) && !isPlatformDb(db)) {
      await recordFailureReceipt(
        db,
        ctx,
        { ...outer.data, payload: receiptPayload, payloadHash: payloadFingerprint },
        commandError,
        log,
        elapsedMs(started),
      );
    }
    return commandErrorResponse(commandError);
  }
}

/**
 * The platform path: the same spine as a workspace command — validate, look for
 * an existing receipt, write one, execute, all in a single transaction — minus
 * every step that reads per-workspace data. Branch scope, module flags and
 * approval rules are not skipped as a favour to provisioning; they are rows in
 * a workspace this command has not created yet.
 */
async function dispatchPlatform(
  db: PlatformDb,
  ctx: OperatorContext,
  definition: PlatformCommandDefinition<unknown>,
  request: { name: string; version: number; envelope: CommandEnvelope; payload: unknown },
  started: number,
): Promise<{ status: number; body: CommandOutcome | ErrorBody }> {
  const parsedPayload = definition.payloadSchema.safeParse(request.payload);
  if (!parsedPayload.success) {
    throw new CommandError(400, "VALIDATION_FAILED", {
      issues: parsedPayload.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path,
      })),
    });
  }
  /** What the receipt stores: no secret survives into a row kept forever. */
  const receiptPayload = definition.redactPayload
    ? definition.redactPayload(parsedPayload.data)
    : request.payload;

  /**
   * What decides a replay, taken over the payload as it arrived. Comparing the
   * stored side instead would let two provisioning runs that differ only in
   * their PINs replay as one, since redaction maps both to the same marker.
   */
  const payloadFingerprint = fingerprint(request.payload);

  // Source artifacts are tenant rows, so none can exist to link to.
  if (request.envelope.sourceArtifactIds.length > 0) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "sourceArtifact",
      missing: request.envelope.sourceArtifactIds,
    });
  }

  try {
    return await inPlatformScope(db, async (tx) => {
      const existing = await findPlatformReceipt(
        tx,
        ctx.principalId,
        request.envelope.idempotencyKey,
      );
      if (existing) {
        return replayOrConflict(
          existing,
          request.name,
          request.version,
          receiptPayload,
          payloadFingerprint,
        );
      }

      const workspaceId = await definition.resolveWorkspace(
        tx,
        ctx,
        request.envelope,
        parsedPayload.data,
      );

      await tx.insert(commands).values({
        id: request.envelope.commandId,
        workspaceId,
        scope: "PLATFORM",
        commandType: request.name,
        commandVersion: String(request.version),
        origin: request.envelope.origin,
        status: "EXECUTED",
        initiatedByPrincipalId: ctx.principalId,
        idempotencyKey: request.envelope.idempotencyKey,
        clientOccurredAt: request.envelope.clientOccurredAt
          ? new Date(request.envelope.clientOccurredAt)
          : null,
        payload: receiptPayload,
        payloadHash: payloadFingerprint,
        result: null,
        approvalOutcome: null,
        approvalRuleId: null,
      });

      const result = await definition.execute(
        tx,
        ctx,
        request.envelope,
        parsedPayload.data,
        workspaceId,
      );
      const outcome: CommandOutcome = {
        commandId: request.envelope.commandId,
        recordId: result.recordId,
        rowVersion: result.rowVersion,
        ...(result.recordStatus === undefined ? {} : { recordStatus: result.recordStatus }),
        warnings: result.warnings ?? [],
        ...(result.children === undefined ? {} : { children: result.children }),
        idempotentReplay: false,
      };

      await tx
        .update(commands)
        .set({ result: outcome, durationMs: elapsedMs(started) })
        .where(eq(commands.id, outcome.commandId));

      return { status: 200, body: outcome };
    });
  } catch (error) {
    if (uniqueViolation(error)?.constraint === "commands_platform_idem_uq") {
      const existing = await inPlatformScope(db, (tx) =>
        findPlatformReceipt(tx, ctx.principalId, request.envelope.idempotencyKey),
      );
      if (existing) {
        return replayOrConflict(
          existing,
          request.name,
          request.version,
          receiptPayload,
          payloadFingerprint,
        );
      }
    }
    throw error;
  }
}

function isPlatformDb(db: Db | PlatformDb): db is PlatformDb {
  return "bypassRls" in db;
}

function requirePlatformDb(db: Db | PlatformDb): PlatformDb {
  if (!isPlatformDb(db)) {
    throw new Error("platform command dispatched without the platform connection");
  }
  return db;
}

function requireTenantDb(db: Db | PlatformDb): Db {
  if (isPlatformDb(db)) {
    throw new Error("workspace command dispatched on the RLS bypass connection");
  }
  return db;
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
  request: {
    name: string;
    version: number;
    envelope: CommandEnvelope;
    payload: unknown;
    payloadHash: string;
  },
  commandError: CommandError,
  log: CommandLog | undefined,
  durationMs: number,
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
        payloadHash: request.payloadHash,
        result: null,
        failureCode: commandError.code,
        durationMs,
      });
    });
  } catch (receiptError) {
    log?.error({ err: receiptError, event: "command.failure_receipt_failed" });
  }
}

function elapsedMs(started: number): number {
  return Math.round(performance.now() - started);
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
  /** Null on receipts written before the hash existed; see `replayOrConflict`. */
  payloadHash: string | null;
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
      payloadHash: commands.payloadHash,
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

/**
 * A platform command's workspace is its own output, so the key cannot be looked
 * up by workspace the way a tenant retry is — the operator is what a retry has
 * in common with the original. Mirrors `commands_platform_idem_uq`.
 */
async function findPlatformReceipt(
  store: ReceiptStore,
  principalId: string,
  idempotencyKey: string,
): Promise<StoredReceipt | undefined> {
  const [receipt] = await store
    .select({
      commandType: commands.commandType,
      commandVersion: commands.commandVersion,
      payload: commands.payload,
      payloadHash: commands.payloadHash,
      result: commands.result,
    })
    .from(commands)
    .where(
      and(
        eq(commands.scope, "PLATFORM"),
        eq(commands.initiatedByPrincipalId, principalId),
        eq(commands.idempotencyKey, idempotencyKey),
        eq(commands.status, "EXECUTED"),
      ),
    )
    .limit(1);
  return receipt;
}

/**
 * `payloadHash` is the comparison, because it is taken over the raw payload
 * while `payload` is what was safe to store. Two resets under one key to two
 * different PINs redact to the same row and must still conflict.
 *
 * Receipts written before the column existed carry NULL, and fall back to
 * comparing stored payloads — the old behaviour, which is right for them: their
 * stored payload is all the evidence that call left.
 */
function replayOrConflict(
  receipt: StoredReceipt,
  name: string,
  version: number,
  payload: unknown,
  payloadHash: string,
): { status: number; body: CommandOutcome | ErrorBody } {
  const samePayload =
    receipt.payloadHash === null
      ? canonicalJson(receipt.payload) === canonicalJson(payload)
      : receipt.payloadHash === payloadHash;
  const isExactRetry =
    receipt.commandType === name &&
    receipt.commandVersion === String(version) &&
    samePayload;

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

/**
 * Stable fingerprint of a payload: canonical JSON so key order cannot change
 * it, then keyed so the digest cannot be brute-forced back into the payload it
 * came from. See payload-fingerprint.ts for why the key is load-bearing.
 */
function fingerprint(value: unknown): string {
  return fingerprintCanonical(canonicalJson(value));
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
