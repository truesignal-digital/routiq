import type { AssetAvailabilityFilter } from "@routiq/contracts";
import { assetFilterQuery } from "../assets/display.js";
import { assetOverviewQueryOptions } from "../assets/useAssetOverview.js";
import { assetsQueryOptions, type UseAssetsParams } from "../assets/useAssets.js";
import { assetSummaryQueryOptions } from "../assets/useAssetSummary.js";
import { fleetUsageQueryOptions, PAGE_USAGE_RANGE } from "../overview/useFleetUsage.js";
import { ambientBranchId } from "../shell/branch-context.js";
import { scopedParams } from "../shell/branch-scope.js";
import { ensure, ensureList, scope, settle, type LoaderArgs } from "./scope.js";

/**
 * The list as AssetsStub first asks for it: the Overview tile's status or
 * availability from the URL, code order (#302, #665).
 */
export async function assets(
  args: LoaderArgs & {
    deps: { status?: "IN_SERVICE" | "ATTENTION" | undefined; availability?: AssetAvailabilityFilter | undefined };
  },
): Promise<void> {
  const { client, slug, branch } = await scope(args);
  const { status, availability } = args.deps;
  await ensureList(
    client,
    assetsQueryOptions(
      slug,
      scopedParams<UseAssetsParams>(
        { ...assetFilterQuery(status ?? "ALL"), ...(availability === undefined ? {} : { availability }), sort: "assetCode:asc" },
        branch,
      ),
    ),
  );
}

/**
 * The Trucks Overview's tiles and fleet board as TrucksOverview first asks for
 * them (#665, #668); its other cards load with the screen.
 */
export async function trucksOverview(args: LoaderArgs): Promise<void> {
  const { client, slug, branch } = await scope(args);
  await settle(
    ensure(client, assetOverviewQueryOptions(slug, scopedParams({}, branch))),
    ensure(client, assetSummaryQueryOptions(slug, scopedParams({}, branch))),
    ensure(client, fleetUsageQueryOptions(slug, PAGE_USAGE_RANGE, ambientBranchId(branch))),
  );
}
