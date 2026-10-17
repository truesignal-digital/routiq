import { eq } from "drizzle-orm";
import { workspaces } from "../db/schema.js";
import { CommandError, type Tx } from "./dispatcher.js";

/**
 * The workspace a vendor operator's command names by slug, the handle an
 * operator is given. An unknown slug is reported as such before anything is
 * written, so a typo never lands on another tenant.
 */
export async function workspaceBySlug(tx: Tx, workspaceSlug: string): Promise<string> {
  const [workspace] = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.slug, workspaceSlug))
    .limit(1);
  if (!workspace) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "workspace",
      referenceCode: workspaceSlug,
    });
  }
  return workspace.id;
}

/**
 * A shipped v1 that ran inside the caller's own workspace and so names none. It
 * stays registered at platform scope: a tenant sending it is refused with
 * COMMAND_SCOPE_FORBIDDEN by the dispatcher before this runs, and an operator
 * is told the field v2 needs.
 */
export function requiresWorkspaceTarget(): never {
  throw new CommandError(400, "VALIDATION_FAILED", {
    issues: [{ code: "invalid_type", path: ["workspaceSlug"] }],
  });
}
