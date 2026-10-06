import { plateKey } from "@routiq/contracts";
import { and, eq, ne, sql } from "drizzle-orm";
import { assets } from "../db/schema.js";
import { CommandError, type CommandContext, type Tx } from "./dispatcher.js";

/**
 * The workspace half of the vehicle identity rules (#122): a plate another
 * vehicle in the workspace already carries is refused, compared without spaces,
 * dashes or case. register-asset (v2) and update-asset-details both call this;
 * the field rules themselves live in `@routiq/contracts` (`asset-identity.ts`).
 *
 * There is no unique index behind it: register-asset v1 never checked, so a
 * workspace may already hold duplicates. `exceptAssetId` leaves the vehicle
 * being edited out of the comparison.
 */
export async function assertPlateFree(
  tx: Tx,
  ctx: CommandContext,
  plate: string,
  exceptAssetId?: string,
): Promise<void> {
  const [taken] = await tx
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.workspaceId, ctx.workspaceId),
        exceptAssetId === undefined ? undefined : ne(assets.id, exceptAssetId),
        // The SQL twin of `plateKey`.
        sql`upper(regexp_replace(${assets.registrationNumber}, '[[:space:]-]', '', 'g')) = ${plateKey(plate)}`,
      ),
    )
    .limit(1);
  if (taken) {
    throw new CommandError(409, "DUPLICATE_REGISTRATION_NUMBER", { assetId: taken.id });
  }
}
