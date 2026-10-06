import { assetFilterQuery } from "../assets/display.js";
import { assetsQueryOptions, type UseAssetsParams } from "../assets/useAssets.js";
import { assetSummaryQueryOptions } from "../assets/useAssetSummary.js";
import { scopedParams } from "../shell/branch-scope.js";
import { scope, settle, type LoaderArgs } from "./scope.js";

/** The list as AssetsStub first asks for it: the tile's status bucket from the URL, code order (#302). */
export async function assets(args: LoaderArgs & { deps: { status?: "IN_SERVICE" | "ATTENTION" | undefined } }): Promise<void> {
  const { client, slug, branch } = await scope(args);
  await settle(
    client.ensureInfiniteQueryData(
      assetsQueryOptions(slug, scopedParams<UseAssetsParams>({ ...assetFilterQuery(args.deps.status ?? "ALL"), sort: "assetCode:asc" }, branch)),
    ),
    client.ensureQueryData(assetSummaryQueryOptions(slug, scopedParams({}, branch))),
  );
}
