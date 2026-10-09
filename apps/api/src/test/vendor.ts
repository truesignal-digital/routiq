import { randomUUID } from "node:crypto";
import type { ModuleCode, TemplateCode } from "@routiq/contracts";
import { eq } from "drizzle-orm";
import { resolveOperatorContext } from "../auth/context.js";
import type { OperatorContext } from "../auth/types.js";
import { dispatchCommand } from "../commands/dispatcher.js";
import type { Db } from "../db/client.js";
import { platformDb } from "../db/platform.js";
import { principals, workspaces } from "../db/schema.js";
import "../commands/module-toggle.js";
import "../commands/set-template-preset.js";

const operators = new WeakMap<Db, Promise<OperatorContext>>();

/** One vendor operator per test database, as the CLI keeps one. */
export function vendorOperator(db: Db): Promise<OperatorContext> {
  let operator = operators.get(db);
  if (!operator) {
    operator = (async () => {
      const [row] = await db
        .insert(principals)
        .values({ principalType: "VENDOR_OPERATOR", displayName: "vendor-cli" })
        .returning();
      const resolved = row && (await resolveOperatorContext(db, row.id));
      if (!resolved) throw new Error("vendor operator context did not resolve");
      return resolved;
    })();
    operators.set(db, operator);
  }
  return operator;
}

/** Runs a vendor-only platform command against a workspace, as the CLI does. */
export async function asVendor(
  db: Db,
  name: string,
  version: number,
  payload: Record<string, unknown>,
  idempotencyKey = `vendor-${randomUUID()}`,
): ReturnType<typeof dispatchCommand> {
  return dispatchCommand(platformDb(db), await vendorOperator(db), {
    name,
    version,
    envelope: { commandId: randomUUID(), idempotencyKey, origin: "API" },
    payload,
  });
}

async function slugOf(db: Db, workspaceId: string): Promise<string> {
  const [row] = await db
    .select({ slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!row) throw new Error(`no workspace ${workspaceId}`);
  return row.slug;
}

/** Turns a module on or off for a workspace the way the vendor does (ADR-0005). */
export async function setModule(
  db: Db,
  workspaceId: string,
  moduleCode: Exclude<ModuleCode, "CORE">,
  enabled: boolean,
): Promise<void> {
  const reply = await asVendor(db, enabled ? "enable-module" : "disable-module", 2, {
    workspaceSlug: await slugOf(db, workspaceId),
    moduleCode,
  });
  if (reply.status !== 200) {
    throw new Error(`${enabled ? "enable" : "disable"}-module ${moduleCode}: ${JSON.stringify(reply.body)}`);
  }
}

/** Turns a template preset on or off for a workspace the way the vendor does. */
export async function setPreset(
  db: Db,
  workspaceId: string,
  presetCode: TemplateCode,
  enabled: boolean,
): Promise<void> {
  const reply = await asVendor(db, "set-template-preset", 2, {
    workspaceSlug: await slugOf(db, workspaceId),
    presetCode,
    enabled,
  });
  if (reply.status !== 200) {
    throw new Error(`set-template-preset ${presetCode}: ${JSON.stringify(reply.body)}`);
  }
}
