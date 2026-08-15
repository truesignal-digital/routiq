import {
  provisionWorkspacePayload,
  provisionWorkspaceV1Payload,
  provisionWorkspaceV1ToV2,
  type CommandEnvelope,
  type ProvisionWorkspacePayload,
  type ProvisionWorkspaceV1Payload,
} from "@routiq/contracts";
import { eq } from "drizzle-orm";
import { hashPin } from "../auth/pin.js";
import {
  approvalRules,
  branches,
  categories,
  credentials,
  memberships,
  principals,
  workspaceModules,
  workspaceTemplates,
  workspaces,
} from "../db/schema.js";
import { corePack } from "../provisioning/packs/core.js";
import { PRESET_PACKS, type StarterPack } from "../provisioning/packs/index.js";
import { REDACTED_PIN } from "./redaction.js";
import type { OperatorContext } from "../auth/types.js";
import {
  appendPlatformAuditEvent,
  CommandError,
  registerPlatformCommand,
  type CommandExecuteResult,
  type Tx,
} from "./dispatcher.js";

export { REDACTED_PIN } from "./redaction.js";

/**
 * Tenant #3 without hand-written SQL (ADR-0004): workspace, branches, user
 * credentials, enabled presets and their starter packs, in the transaction that
 * writes the command receipt. Every row it creates carries this command's id, so
 * a provisioned workspace has the same provenance as one built by daily use.
 *
 * Pack rows are inserted directly rather than replayed as sub-commands: the
 * runtime category commands that would own those writes do not exist yet
 * (research item 3). When they land, this becomes replay.
 */
/** The parts of the payload both versions carry verbatim; only branches differ. */
type ProvisionCommon = Pick<ProvisionWorkspacePayload, "workspace" | "admin" | "users">;

/**
 * PINs are the secrets a command payload carries, and a receipt is kept
 * forever — so none reaches the row. Only PINs are replaced: the rest stays
 * byte-identical, so a receipt still reads as a record of what ran, in the
 * shape it arrived in.
 *
 * Redaction no longer costs anything on the idempotency side. The dispatcher
 * compares `commands.payload_hash`, taken over the raw payload before this
 * runs, so two runs differing only in their PINs conflict as they should
 * while an honest re-run of the same file still replays.
 */
function redactPins<P extends ProvisionCommon>(payload: P): P {
  return {
    ...payload,
    admin: { ...payload.admin, pin: REDACTED_PIN },
    ...(payload.users === undefined
      ? {}
      : {
          users: payload.users.map((user) => ({
            ...user,
            pin: REDACTED_PIN,
          })),
        }),
  };
}

async function createWorkspace(
  tx: Tx,
  _ctx: OperatorContext,
  _envelope: CommandEnvelope,
  payload: ProvisionCommon,
): Promise<string> {
  const [taken] = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.slug, payload.workspace.slug))
    .limit(1);
  if (taken) {
    throw new CommandError(409, "DUPLICATE_WORKSPACE_SLUG", { slug: payload.workspace.slug });
  }

  await tx.insert(workspaces).values({
    id: payload.workspace.id,
    slug: payload.workspace.slug,
    name: payload.workspace.name,
    defaultCurrency: payload.workspace.defaultCurrency,
    timezone: payload.workspace.timezone,
    defaultLocale: payload.workspace.defaultLocale,
  });
  return payload.workspace.id;
}

async function executeProvision(
  tx: Tx,
  ctx: OperatorContext,
  envelope: CommandEnvelope,
  payload: ProvisionWorkspacePayload,
  workspaceId: string,
): Promise<CommandExecuteResult> {
  const commandId = envelope.commandId;

  await tx.insert(branches).values(
    payload.branches.map((branch) => ({
      id: branch.id,
      workspaceId,
      code: branch.code,
      name: branch.name,
      ...(branch.timezone === undefined ? {} : { timezone: branch.timezone }),
      createdByCommandId: commandId,
    })),
  );
  const branchIdByCode = new Map(payload.branches.map((branch) => [branch.code, branch.id]));

  // Order is load-bearing: credentials carry a composite FK to memberships, so
  // the admin must be a member before it can hold a PIN.
  await tx.insert(principals).values({
    id: payload.admin.id,
    principalType: "HUMAN",
    displayName: payload.admin.displayName,
  });
  await tx.insert(memberships).values({
    workspaceId,
    principalId: payload.admin.id,
    role: "ADMIN",
    allBranches: true,
  });
  await tx.insert(credentials).values({
    workspaceId,
    principalId: payload.admin.id,
    username: payload.admin.username,
    pinHash: await hashPin(payload.admin.pin),
  });

  for (const user of payload.users ?? []) {
    const scopedBranchIds =
      user.branchScope === "ALL" ? [] : resolveBranchIds(user.branchScope, branchIdByCode);

    await tx.insert(principals).values({
      id: user.id,
      principalType: "HUMAN",
      displayName: user.displayName,
    });
    await tx.insert(memberships).values({
      workspaceId,
      principalId: user.id,
      role: user.role,
      allBranches: user.branchScope === "ALL",
      branchIds: scopedBranchIds,
    });
    await tx.insert(credentials).values({
      workspaceId,
      principalId: user.id,
      username: user.username,
      pinHash: await hashPin(user.pin),
    });
  }

  await tx.insert(workspaceTemplates).values(
    payload.enabledPresets.map((presetCode) => ({
      workspaceId,
      presetCode,
      enabled: true,
      updatedByCommandId: commandId,
    })),
  );

  // Only the disabled ones: absent means enabled, and writing a row per module
  // would turn that default into stored state (spec open question, answered no).
  if (payload.disabledModules.length > 0) {
    await tx.insert(workspaceModules).values(
      payload.disabledModules.map((moduleCode) => ({
        workspaceId,
        moduleCode,
        enabled: false,
        updatedByCommandId: commandId,
      })),
    );
  }

  const packed = await replayPacks(tx, workspaceId, commandId, payload.enabledPresets);

  await appendPlatformAuditEvent(tx, ctx, workspaceId, envelope, {
    eventType: "workspace.provisioned",
    entityType: "workspace",
    entityId: workspaceId,
    afterState: {
      slug: payload.workspace.slug,
      name: payload.workspace.name,
      defaultCurrency: payload.workspace.defaultCurrency,
      timezone: payload.workspace.timezone,
      defaultLocale: payload.workspace.defaultLocale,
      branches: payload.branches.map((branch) => ({
        id: branch.id,
        code: branch.code,
        name: branch.name,
        ...(branch.timezone === undefined ? {} : { timezone: branch.timezone }),
      })),
      // Username and display name only — a PIN or its hash never reaches the trail.
      admin: {
        principalId: payload.admin.id,
        displayName: payload.admin.displayName,
        username: payload.admin.username,
        role: "ADMIN",
      },
      users: (payload.users ?? []).map((user) => ({
        principalId: user.id,
        displayName: user.displayName,
        username: user.username,
        role: user.role,
        branchScope: user.branchScope,
      })),
      enabledPresets: payload.enabledPresets,
      disabledModules: payload.disabledModules,
      packs: packed,
    },
  });

  return { recordId: workspaceId, rowVersion: 1 };
}

registerPlatformCommand<ProvisionWorkspacePayload>({
  scope: "platform",
  name: "provision-workspace",
  version: 2,
  payloadSchema: provisionWorkspacePayload,
  redactPayload: redactPins,
  createWorkspace,
  execute: executeProvision,
});

/**
 * The compatibility half of the version bump (ARCHITECTURE.md §6). v1 took a
 * single `branch` object under a loose code rule; it stays registered so an
 * already-authored tenant file, and any client still posting the old shape,
 * keep validating. Nothing downstream knows about it — the payload is mapped to
 * a one-element array and runs the same execution path, so there is no second
 * provisioning implementation to keep in step.
 *
 * What this does NOT buy: replay of an old receipt under a new payload. The
 * fingerprint is taken over the raw payload, so a v1 receipt and a v2 payload
 * under one idempotency key conflict by design — which is why the seed and the
 * CLI moved to v2 under new keys rather than reusing theirs.
 */
registerPlatformCommand<ProvisionWorkspaceV1Payload>({
  scope: "platform",
  name: "provision-workspace",
  version: 1,
  payloadSchema: provisionWorkspaceV1Payload,
  redactPayload: redactPins,
  createWorkspace,
  execute: (tx, ctx, envelope, payload, workspaceId) =>
    executeProvision(tx, ctx, envelope, provisionWorkspaceV1ToV2(payload), workspaceId),
});

/**
 * A provisioned user's scope is written in branch codes, because the file a
 * vendor hands over names branches the way people do. The branches it can name
 * are exactly the ones this same command creates — nothing else exists yet — so
 * an unknown code is a bad file, reported as such before anything is inserted.
 */
function resolveBranchIds(
  branchCodes: readonly string[],
  branchIdByCode: ReadonlyMap<string, string>,
): string[] {
  const ids: string[] = [];
  const missing: string[] = [];
  for (const branchCode of branchCodes) {
    const id = branchIdByCode.get(branchCode);
    if (id === undefined) missing.push(branchCode);
    else if (!ids.includes(id)) ids.push(id);
  }
  if (missing.length > 0) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "branch",
      missing,
    });
  }
  return ids;
}

/**
 * Core pack plus one pack per enabled preset. A single-preset workspace gets the
 * shared core and its own preset only — the other business type's vocabulary is
 * what ADR-0004 set out to stop showing every tenant.
 */
async function replayPacks(
  tx: Tx,
  workspaceId: string,
  commandId: string,
  enabledPresets: ProvisionWorkspacePayload["enabledPresets"],
): Promise<Array<{ code: string; version: number }>> {
  const packs: StarterPack[] = [
    corePack,
    ...enabledPresets.map((preset) => PRESET_PACKS[preset]),
  ];

  await tx.insert(categories).values(
    packs.flatMap((pack) =>
      pack.categories.map((category) => ({
        ...category,
        workspaceId,
        createdByCommandId: commandId,
      })),
    ),
  );

  await tx.insert(approvalRules).values(
    packs.flatMap((pack) =>
      (pack.approvalRules ?? []).map((rule) => ({
        ...rule,
        workspaceId,
        createdByCommandId: commandId,
      })),
    ),
  );

  return packs.map((pack) => ({ code: pack.code, version: pack.version }));
}
