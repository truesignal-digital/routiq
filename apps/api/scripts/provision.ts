import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  provisionWorkspacePayload,
  TOGGLEABLE_MODULE_CODES,
  type ProvisionWorkspacePayload,
} from "@routiq/contracts";
import { asc, eq } from "drizzle-orm";
import { resolveOperatorContext } from "../src/auth/context.js";
import { authDb, authPool, pool } from "../src/db/client.js";
import { platformDb } from "../src/db/platform.js";
import { principals } from "../src/db/schema.js";
import {
  dispatchCommand,
  type CommandOutcome,
} from "../src/commands/dispatcher.js";
import "../src/commands/provision-workspace.js";

const PROVISION_ID_NAMESPACE = "4ad8d95b-d6d0-4a2a-9b98-c64a19d0c15d";
const allowedDisabledModules = new Set<string>(TOGGLEABLE_MODULE_CODES);

type Logger = (message: string) => void;

export interface ProvisionResult {
  workspaceId: string;
  workspaceSlug: string;
  branchCodes: string[];
  adminUsername: string;
  commandId: string;
  idempotentReplay: boolean;
}

class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function deterministicProvisionId(name: string): string {
  const namespaceBytes = Buffer.from(PROVISION_ID_NAMESPACE.replaceAll("-", ""), "hex");
  const digest = createHash("sha1")
    .update(namespaceBytes)
    .update(name, "utf8")
    .digest()
    .subarray(0, 16);

  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;

  const hex = digest.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export async function provisionTenant(
  tenantInput: unknown,
  log: Logger = console.log,
  options: { commandId?: string; idempotencyKey?: string } = {},
): Promise<ProvisionResult> {
  rejectUnknownModuleCodes(tenantInput);
  const payload = parseTenantPayload(withMissingIds(tenantInput));

  const branchIds = payload.branches
    .map((branch) => `${branch.code}=${branch.id}`)
    .join(" ");
  log(
    `Loaded tenant IDs: workspace=${payload.workspace.id} branches[${branchIds}] admin=${payload.admin.id}`,
  );

  const operator = await getOrCreateVendorOperator();
  const commandId = options.commandId ?? randomUUID();
  const response = await dispatchCommand(platformDb(authDb), operator, {
    name: "provision-workspace",
    version: 2,
    envelope: {
      commandId,
      /**
       * `:v2` and not the bare slug: a workspace provisioned before the array
       * shape holds a receipt under the old key, and the fingerprint is taken
       * over the raw payload — so reusing the key would answer 409
       * IDEMPOTENCY_KEY_REUSED rather than replaying (issue #20).
       */
      idempotencyKey: options.idempotencyKey ?? `provision-${payload.workspace.slug}:v2`,
      origin: "API",
    },
    payload,
  });

  if ("error" in response.body) {
    throw commandFailure(response.status, response.body.error.code, response.body.error.metadata);
  }

  const result = presentResult(payload, response.body, log);
  return result;
}

export async function provisionFromFile(
  filePath: string,
  log: Logger = console.log,
): Promise<ProvisionResult> {
  const absolutePath = resolve(filePath);
  let source: string;
  try {
    source = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new CliError(`Unable to read tenant file "${absolutePath}": ${errorMessage(error)}`);
  }

  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch (error) {
    throw new CliError(`Invalid JSON in tenant file "${absolutePath}": ${errorMessage(error)}`);
  }

  return provisionTenant(input, log);
}

function withMissingIds(input: unknown): unknown {
  if (!isRecord(input)) return input;

  const workspace = isRecord(input["workspace"]) ? input["workspace"] : {};
  const branchList = Array.isArray(input["branches"]) ? input["branches"] : undefined;
  const admin = isRecord(input["admin"]) ? input["admin"] : {};
  const users = Array.isArray(input["users"]) ? input["users"] : undefined;
  const slug = typeof workspace["slug"] === "string" ? workspace["slug"] : "";
  const adminUsername = typeof admin["username"] === "string" ? admin["username"] : "";

  return {
    ...input,
    workspace: {
      ...workspace,
      id:
        workspace["id"] ??
        deterministicProvisionId(`workspace:${slug}`),
    },
    ...(branchList === undefined
      ? {}
      : {
          branches: branchList.map((candidate) => {
            if (!isRecord(candidate)) return candidate;
            const branchCode =
              typeof candidate["code"] === "string" ? candidate["code"] : "";
            return {
              ...candidate,
              id:
                candidate["id"] ??
                deterministicProvisionId(`branch:${slug}:${branchCode}`),
            };
          }),
        }),
    admin: {
      ...admin,
      id:
        admin["id"] ??
        deterministicProvisionId(`admin:${slug}:${adminUsername}`),
    },
    ...(users === undefined
      ? {}
      : {
          users: users.map((candidate) => {
            if (!isRecord(candidate)) return candidate;
            const username =
              typeof candidate["username"] === "string" ? candidate["username"] : "";
            return {
              ...candidate,
              id:
                candidate["id"] ??
                deterministicProvisionId(`user:${slug}:${username}`),
            };
          }),
        }),
  };
}

function rejectUnknownModuleCodes(input: unknown): void {
  if (!isRecord(input) || !Array.isArray(input["disabledModules"])) return;

  const unknownCodes = input["disabledModules"].filter(
    (code): code is string => typeof code === "string" && !allowedDisabledModules.has(code),
  );
  if (unknownCodes.length === 0) return;

  throw new CliError(
    `Unknown disabled module code(s): ${unknownCodes.join(", ")}. Allowed codes: ${TOGGLEABLE_MODULE_CODES.join(", ")}`,
  );
}

function parseTenantPayload(input: unknown): ProvisionWorkspacePayload {
  const parsed = provisionWorkspacePayload.safeParse(input);
  if (parsed.success) return parsed.data;

  const issues = parsed.error.issues.map((issue) => {
    const path = issue.path.length === 0 ? "<root>" : issue.path.join(".");
    return `  - ${path}: ${issue.message}`;
  });
  throw new CliError(`Invalid tenant file:\n${issues.join("\n")}`);
}

async function getOrCreateVendorOperator() {
  const [existing] = await authDb
    .select({ id: principals.id })
    .from(principals)
    .where(eq(principals.principalType, "VENDOR_OPERATOR"))
    .orderBy(asc(principals.id))
    .limit(1);

  let principalId = existing?.id;
  if (!principalId) {
    const [created] = await authDb
      .insert(principals)
      .values({
        principalType: "VENDOR_OPERATOR",
        displayName: "Vendor CLI",
      })
      .returning({ id: principals.id });
    principalId = created?.id;
  }
  if (!principalId) {
    throw new CliError("Unable to create the vendor operator principal.");
  }

  const operator = await resolveOperatorContext(authDb, principalId);
  if (!operator) {
    throw new CliError(
      `Vendor operator principal ${principalId} is disabled or has an invalid principal type.`,
    );
  }
  return operator;
}

function presentResult(
  payload: ProvisionWorkspacePayload,
  outcome: CommandOutcome,
  log: Logger,
): ProvisionResult {
  if (outcome.idempotentReplay) {
    log(`Idempotent replay: existing workspace id=${outcome.recordId} slug=${payload.workspace.slug}`);
  } else {
    log(`Provisioned workspace: id=${outcome.recordId} slug=${payload.workspace.slug}`);
  }
  const branchCodes = payload.branches.map((branch) => branch.code);
  log(`Branches: ${branchCodes.join(", ")}`);
  log(`Admin: username=${payload.admin.username}`);
  log(`Command: id=${outcome.commandId}`);

  return {
    workspaceId: outcome.recordId,
    workspaceSlug: payload.workspace.slug,
    branchCodes,
    adminUsername: payload.admin.username,
    commandId: outcome.commandId,
    idempotentReplay: outcome.idempotentReplay,
  };
}

function commandFailure(
  status: number,
  code: string,
  metadata: Record<string, unknown> | undefined,
): CliError {
  if (code === "DUPLICATE_WORKSPACE_SLUG") {
    const slug = typeof metadata?.["slug"] === "string" ? metadata["slug"] : "requested slug";
    return new CliError(`Provision failed (${status} ${code}): workspace slug "${slug}" already exists.`);
  }
  return new CliError(`Provision failed (${status} ${code}).`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(resolve(entrypoint)).href;
}

if (isEntrypoint()) {
  try {
    const { values } = parseArgs({
      options: {
        file: { type: "string", short: "f" },
      },
      strict: true,
      allowPositionals: false,
    });
    if (!values.file) {
      throw new CliError("Usage: pnpm --filter @routiq/api provision --file <path>");
    }
    await provisionFromFile(values.file);
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = error instanceof CliError ? error.exitCode : 1;
  } finally {
    await Promise.all([pool.end(), authPool.end()]);
  }
}
