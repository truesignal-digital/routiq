import { canOpenEntriesList } from "../dashboard/cards.js";
import { dashboardQueryOptions, HOME_RANGE_DAYS } from "../dashboard/useDashboard.js";
import { entriesQueryOptions } from "../finance/useEntries.js";
import { ambientBranchId } from "../shell/branch-context.js";
import { scopedParams } from "../shell/branch-scope.js";
import { scope, settle, type LoaderArgs } from "./scope.js";

export async function home(args: LoaderArgs): Promise<void> {
  const { client, slug, me, branch } = await scope(args);
  await settle(
    client.ensureQueryData(dashboardQueryOptions(slug, HOME_RANGE_DAYS, ambientBranchId(branch))),
    canOpenEntriesList(me?.role, me?.enabledModules) &&
      client.ensureInfiniteQueryData(entriesQueryOptions(slug, scopedParams({}, branch))),
  );
}

