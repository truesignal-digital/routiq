/**
 * Turns a module or a template preset on or off for one workspace, as the
 * vendor operator (ADR-0005), through the `enable-module` / `disable-module` /
 * `set-template-preset` platform commands:
 *
 *   pnpm --filter @routiq/api entitlement --workspace <slug> --disable-module FINANCE
 *   pnpm --filter @routiq/api entitlement --workspace <slug> --enable-preset PASSENGER_TRANSPORT
 *
 * Exactly one of --enable-module, --disable-module, --enable-preset,
 * --disable-preset. Tenants cannot make these changes from the app.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { TEMPLATE_CODES, TOGGLEABLE_MODULE_CODES } from "@routiq/contracts";
import { authDb, authPool, pool } from "../src/db/client.js";
import { platformDb } from "../src/db/platform.js";
import { dispatchCommand, type CommandOutcome } from "../src/commands/dispatcher.js";
import "../src/commands/module-toggle.js";
import "../src/commands/set-template-preset.js";
import { getOrCreateVendorOperator } from "./provision.js";

export type EntitlementChange =
  | { kind: "module"; code: (typeof TOGGLEABLE_MODULE_CODES)[number]; enabled: boolean }
  | { kind: "preset"; code: (typeof TEMPLATE_CODES)[number]; enabled: boolean };

export async function changeEntitlement(
  workspaceSlug: string,
  change: EntitlementChange,
  log: (message: string) => void = console.log,
): Promise<CommandOutcome> {
  const operator = await getOrCreateVendorOperator();
  const request =
    change.kind === "module"
      ? {
          name: change.enabled ? "enable-module" : "disable-module",
          payload: { workspaceSlug, moduleCode: change.code },
        }
      : {
          name: "set-template-preset",
          payload: { workspaceSlug, presetCode: change.code, enabled: change.enabled },
        };
  const response = await dispatchCommand(platformDb(authDb), operator, {
    name: request.name,
    version: 2,
    envelope: {
      commandId: randomUUID(),
      idempotencyKey: `entitlement:${workspaceSlug}:${change.kind}:${change.code}:${randomUUID()}`,
      origin: "API",
    },
    payload: request.payload,
  });
  if ("error" in response.body) {
    throw new Error(
      `${request.name} failed (${response.status} ${response.body.error.code}) ${JSON.stringify(response.body.error.metadata ?? {})}`,
    );
  }
  log(
    `${change.kind === "module" ? "Module" : "Preset"} ${change.code} ${change.enabled ? "enabled" : "disabled"} for ${workspaceSlug} (command ${response.body.commandId})`,
  );
  return response.body;
}

const USAGE =
  "Usage: pnpm --filter @routiq/api entitlement --workspace <slug> " +
  "(--enable-module <code> | --disable-module <code> | --enable-preset <code> | --disable-preset <code>)";

function parseChange(values: Record<string, string | undefined>): EntitlementChange {
  const given = (["enable-module", "disable-module", "enable-preset", "disable-preset"] as const).filter(
    (flag) => values[flag] !== undefined,
  );
  const flag = given[0];
  if (given.length !== 1 || flag === undefined) throw new Error(USAGE);
  const code = values[flag]!;
  const enabled = flag.startsWith("enable");
  if (flag.endsWith("module")) {
    const moduleCode = TOGGLEABLE_MODULE_CODES.find((candidate) => candidate === code);
    if (!moduleCode) throw new Error(`Unknown module ${code}. Allowed: ${TOGGLEABLE_MODULE_CODES.join(", ")}`);
    return { kind: "module", code: moduleCode, enabled };
  }
  const presetCode = TEMPLATE_CODES.find((candidate) => candidate === code);
  if (!presetCode) throw new Error(`Unknown preset ${code}. Allowed: ${TEMPLATE_CODES.join(", ")}`);
  return { kind: "preset", code: presetCode, enabled };
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  try {
    const { values } = parseArgs({
      options: {
        workspace: { type: "string" },
        "enable-module": { type: "string" },
        "disable-module": { type: "string" },
        "enable-preset": { type: "string" },
        "disable-preset": { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    });
    if (!values.workspace) throw new Error(USAGE);
    await changeEntitlement(values.workspace, parseChange(values));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await Promise.all([pool.end(), authPool.end()]);
  }
}
