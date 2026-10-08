/**
 * Makes an existing member of a workspace its DIRECTOR (ADR-0009), as the
 * vendor operator, through the `appoint-director` platform command:
 *
 *   pnpm --filter @routiq/api appoint-director --workspace <slug> --username <username>
 *
 * The workspaces migrated from the old roles have no DIRECTOR and no tenant
 * role may grant one; this is how each gets its first.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { authDb, authPool, pool } from "../src/db/client.js";
import { platformDb } from "../src/db/platform.js";
import { dispatchCommand, type CommandOutcome } from "../src/commands/dispatcher.js";
import "../src/commands/appoint-director.js";
import { getOrCreateVendorOperator } from "./provision.js";

export async function appointDirector(
  workspaceSlug: string,
  username: string,
  log: (message: string) => void = console.log,
): Promise<CommandOutcome> {
  const operator = await getOrCreateVendorOperator();
  const response = await dispatchCommand(platformDb(authDb), operator, {
    name: "appoint-director",
    version: 1,
    envelope: {
      commandId: randomUUID(),
      idempotencyKey: `appoint-director:${workspaceSlug}:${username}`,
      origin: "API",
    },
    payload: { workspaceSlug, username },
  });
  if ("error" in response.body) {
    throw new Error(
      `appoint-director failed (${response.status} ${response.body.error.code}) ${JSON.stringify(response.body.error.metadata ?? {})}`,
    );
  }
  log(
    `${response.body.idempotentReplay ? "Already appointed" : "Appointed"}: ${username} is DIRECTOR of ${workspaceSlug} (command ${response.body.commandId})`,
  );
  return response.body;
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  try {
    const { values } = parseArgs({
      options: { workspace: { type: "string" }, username: { type: "string" } },
      strict: true,
      allowPositionals: false,
    });
    if (!values.workspace || !values.username) {
      throw new Error("Usage: pnpm --filter @routiq/api appoint-director --workspace <slug> --username <username>");
    }
    await appointDirector(values.workspace, values.username);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await Promise.all([pool.end(), authPool.end()]);
  }
}
