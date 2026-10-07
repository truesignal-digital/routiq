import { categoriesQueryOptions } from "../documents/useCategories.js";
import { issueListParams, issuesQueryOptions, workOrdersQueryOptions } from "../maintenance/useMaintenance.js";
import { scopedParams } from "../shell/branch-scope.js";
import { ensure, ensureList, scope, settle, type LoaderArgs } from "./scope.js";

export async function maintenance(args: LoaderArgs): Promise<void> {
  const { client, slug, branch } = await scope(args);
  await settle(
    ensureList(client, workOrdersQueryOptions(slug, scopedParams({}, branch))),
    ensureList(client, issuesQueryOptions(slug, scopedParams(issueListParams({}), branch))),
    ensure(client, categoriesQueryOptions(slug, "ISSUE_TYPE")),
  );
}

