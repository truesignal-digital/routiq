import { activitiesQueryOptions, activitySummaryQueryOptions, type UseActivitiesParams } from "../activities/useActivities.js";
import { assetsQueryOptions } from "../assets/useAssets.js";
import { categoriesQueryOptions } from "../categories/useCategories.js";
import { scopedParams } from "../shell/branch-scope.js";
import { ensure, ensureList, scope, settle, type LoaderArgs } from "./scope.js";

interface ActivitiesSearch {
  status?: string | undefined;
  completeness?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

/** Trips as ActivitiesScreen first asks for them: the URL's filters (#302, #511), newest first. */
export async function activities(args: LoaderArgs & { deps: ActivitiesSearch }): Promise<void> {
  const { client, slug, branch } = await scope(args);
  const { status, completeness, from, to } = args.deps;
  await settle(
    ensure(client, categoriesQueryOptions(slug, "ACTIVITY_TYPE")),
    // The asset filter's options: the first page; the screen drains the rest.
    ensureList(client, assetsQueryOptions(slug, scopedParams({}, branch))),
    ensure(client, activitySummaryQueryOptions(slug, scopedParams({}, branch))),
    ensureList(client,
      activitiesQueryOptions(
        slug,
        scopedParams<UseActivitiesParams>(
          {
            ...(status ? { status } : {}),
            ...(completeness ? { completeness } : {}),
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
            sort: "startedAt:desc",
          },
          branch,
        ),
      ),
    ),
  );
}
