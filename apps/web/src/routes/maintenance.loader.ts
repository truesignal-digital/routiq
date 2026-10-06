import type { IssueStatus, WorkOrderStatus } from "@routiq/contracts";
import { categoriesQueryOptions } from "../documents/useCategories.js";
import {
  issueListParams,
  issuesQueryOptions,
  maintenanceSummaryQueryOptions,
  workOrdersQueryOptions,
  type UseWorkOrdersParams,
} from "../maintenance/useMaintenance.js";
import { scopedParams } from "../shell/branch-scope.js";
import { scope, settle, type LoaderArgs } from "./scope.js";

interface MaintenanceSearch {
  status?: WorkOrderStatus | undefined;
  issueStatus?: IssueStatus | undefined;
}

/** The workshop as MaintenanceScreen first asks for it: tiles, both queues under the URL's filters, every problem for the tile counts. */
export async function maintenance(args: LoaderArgs & { deps: MaintenanceSearch }): Promise<void> {
  const { client, slug, branch } = await scope(args);
  const { status, issueStatus } = args.deps;
  await settle(
    client.ensureQueryData(maintenanceSummaryQueryOptions(slug, scopedParams({}, branch))),
    client.ensureInfiniteQueryData(workOrdersQueryOptions(slug, scopedParams<UseWorkOrdersParams>(status === undefined ? {} : { status }, branch))),
    client.ensureInfiniteQueryData(
      issuesQueryOptions(slug, scopedParams(issueListParams(issueStatus === undefined ? {} : { status: issueStatus }), branch)),
    ),
    issueStatus !== undefined && client.ensureInfiniteQueryData(issuesQueryOptions(slug, scopedParams(issueListParams({}), branch))),
    client.ensureQueryData(categoriesQueryOptions(slug, "ISSUE_TYPE")),
  );
}
