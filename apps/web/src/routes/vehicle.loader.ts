import { assetDetailQueryOptions } from "../assets/useAssetDetail.js";
import { categoriesQueryOptions } from "../documents/useCategories.js";
import { canReadFinance } from "../finance/permissions.js";
import { actionDef, actionPermitted } from "../vehicle/actions.js";
import { viewerOf } from "../vehicle/model.js";
import { assetAttentionQueryOptions, assetFinanceQueryOptions, assetHistoryQueryOptions } from "../vehicle/useVehicle.js";
import { scope, settle, type LoaderArgs } from "./scope.js";

/** The workspace around every vehicle tab: the vehicle, what needs doing on it, and revenue categories when the member may record revenue. */
export async function vehicle(args: LoaderArgs & { params: { assetId: string } }): Promise<void> {
  const { client, slug, me } = await scope(args);
  const { assetId } = args.params;
  await settle(
    client.ensureQueryData(assetDetailQueryOptions(slug, assetId)),
    client.ensureQueryData(assetAttentionQueryOptions(slug, assetId)),
    me !== undefined &&
      actionPermitted(actionDef("record-revenue"), viewerOf(me)) &&
      client.ensureQueryData(categoriesQueryOptions(slug, "REVENUE_CATEGORY")),
  );
}

export async function vehicleNow(args: LoaderArgs & { params: { assetId: string } }): Promise<void> {
  const { client, slug, me } = await scope(args);
  const { assetId } = args.params;
  await settle(
    canReadFinance(me?.role, me?.enabledModules) && client.ensureQueryData(assetFinanceQueryOptions(slug, assetId, undefined)),
    client.ensureInfiniteQueryData(assetHistoryQueryOptions(slug, assetId, undefined, 5)),
  );
}

