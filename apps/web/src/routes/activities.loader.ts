import { activitiesQueryOptions, type UseActivitiesParams } from "../activities/useActivities.js";
import { assetsQueryOptions } from "../assets/useAssets.js";
import { categoriesQueryOptions } from "../documents/useCategories.js";
import { scopedParams } from "../shell/branch-scope.js";
import { scope, settle, type LoaderArgs } from "./scope.js";

export async function activities(args: LoaderArgs): Promise<void> {
  const { client, slug, branch } = await scope(args);
  await settle(
    client.ensureQueryData(categoriesQueryOptions(slug, "ACTIVITY_TYPE")),
    // The asset filter's options: the first page; the screen drains the rest.
    client.ensureInfiniteQueryData(assetsQueryOptions(slug, scopedParams({}, branch))),
    client.ensureInfiniteQueryData(activitiesQueryOptions(slug, scopedParams<UseActivitiesParams>({ sort: "startedAt:desc" }, branch))),
  );
}

