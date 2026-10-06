import { categoriesQueryOptions } from "../documents/useCategories.js";
import { issueListParams, issuesQueryOptions, workOrdersQueryOptions } from "../maintenance/useMaintenance.js";
import { scopedParams } from "../shell/branch-scope.js";
import { scope, settle, type LoaderArgs } from "./scope.js";

export async function maintenance(args: LoaderArgs): Promise<void> {
  const { client, slug, branch } = await scope(args);
  await settle(
    client.ensureInfiniteQueryData(workOrdersQueryOptions(slug, scopedParams({}, branch))),
    client.ensureInfiniteQueryData(issuesQueryOptions(slug, scopedParams(issueListParams({}), branch))),
    client.ensureQueryData(categoriesQueryOptions(slug, "ISSUE_TYPE")),
  );
}

