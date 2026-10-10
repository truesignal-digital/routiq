import type { IssueStatus, WorkOrderStatus } from "@routiq/contracts";
import { categoriesQueryOptions } from "../categories/useCategories.js";
import {
  issueListParams,
  issuesQueryOptions,
  maintenanceSummaryQueryOptions,
  workOrdersQueryOptions,
  type UseWorkOrdersParams,
} from "../maintenance/useMaintenance.js";
import { scopedParams } from "../shell/branch-scope.js";
import { ensure, ensureList, scope, settle, type LoaderArgs } from "./scope.js";

interface MaintenanceSearch {
  status?: WorkOrderStatus | undefined;
  issueStatus?: IssueStatus | undefined;
}

/** The workshop as MaintenanceScreen first asks for it: tiles, both queues under the URL's filters, every problem for the tile counts. */
export async function maintenance(args: LoaderArgs & { deps: MaintenanceSearch }): Promise<void> {
  const { client, slug, branch } = await scope(args);
  const { status, issueStatus } = args.deps;
  await settle(
    ensure(client, maintenanceSummaryQueryOptions(slug, scopedParams({}, branch))),
    ensureList(client, workOrdersQueryOptions(slug, scopedParams<UseWorkOrdersParams>(status === undefined ? {} : { status }, branch))),
    ensureList(client,
      issuesQueryOptions(slug, scopedParams(issueListParams(issueStatus === undefined ? {} : { status: issueStatus }), branch)),
    ),
    issueStatus !== undefined && ensureList(client, issuesQueryOptions(slug, scopedParams(issueListParams({}), branch))),
    ensure(client, categoriesQueryOptions(slug, "ISSUE_TYPE")),
  );
}
