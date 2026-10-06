import { assetsQueryOptions, type UseAssetsParams } from "../assets/useAssets.js";
import { assetSummaryQueryOptions } from "../assets/useAssetSummary.js";
import { scopedParams } from "../shell/branch-scope.js";
import { scope, settle, type LoaderArgs } from "./scope.js";

export async function assets(args: LoaderArgs): Promise<void> {
  const { client, slug, branch } = await scope(args);
  await settle(
    client.ensureInfiniteQueryData(assetsQueryOptions(slug, scopedParams<UseAssetsParams>({ sort: "assetCode:asc" }, branch))),
    client.ensureQueryData(assetSummaryQueryOptions(slug, scopedParams({}, branch))),
  );
}

