import { activitiesQueryOptions, activitySummaryQueryOptions, type UseActivitiesParams } from "../activities/useActivities.js";
import { assetsQueryOptions } from "../assets/useAssets.js";
import { categoriesQueryOptions } from "../categories/useCategories.js";
import { fleetUsageQueryOptions, PAGE_USAGE_RANGE } from "../overview/useFleetUsage.js";
import { ambientBranchId } from "../shell/branch-context.js";
import { scopedParams } from "../shell/branch-scope.js";
import { ensure, ensureList, scope, settle, type LoaderArgs } from "./scope.js";

interface ActivitiesSearch {
  status?: string | undefined;
  completeness?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  missing?: string | undefined;
}

/** Trips as ActivitiesScreen first asks for them: the URL's filters (#302, #511, #665), newest first. */
export async function activities(args: LoaderArgs & { deps: ActivitiesSearch }): Promise<void> {
  const { client, slug, branch } = await scope(args);
  const { status, completeness, from, to, missing } = args.deps;
  await settle(
    ensure(client, categoriesQueryOptions(slug, "ACTIVITY_TYPE")),
    // The asset filter's options: the first page; the screen drains the rest.
    ensureList(client, assetsQueryOptions(slug, scopedParams({}, branch))),
    ensureList(client,
      activitiesQueryOptions(
        slug,
        scopedParams<UseActivitiesParams>(
          {
            ...(status ? { status } : {}),
            ...(completeness ? { completeness } : {}),
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
            ...(missing ? { missing } : {}),
            sort: "startedAt:desc",
          },
          branch,
        ),
      ),
    ),
  );
}

/** The Trips Overview as TripsOverview first asks for it: the summary (#665) and the km read (#668). */
export async function tripsOverview(args: LoaderArgs): Promise<void> {
  const { client, slug, branch } = await scope(args);
  await settle(
    ensure(client, activitySummaryQueryOptions(slug, scopedParams({}, branch))),
    ensure(client, fleetUsageQueryOptions(slug, PAGE_USAGE_RANGE, ambientBranchId(branch))),
  );
}
