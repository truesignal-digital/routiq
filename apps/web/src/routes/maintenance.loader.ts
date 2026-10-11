import type { IssueStatus, WorkOrderStatus } from "@routiq/contracts";
import { categoriesQueryOptions } from "../categories/useCategories.js";
import {
  issueListParams,
  issuesQueryOptions,
  maintenanceSummaryQueryOptions,
  workOrdersQueryOptions,
  type UseWorkOrdersParams,
} from "../maintenance/useMaintenance.js";
import { fleetUsageQueryOptions, PAGE_USAGE_RANGE } from "../overview/useFleetUsage.js";
import { ambientBranchId } from "../shell/branch-context.js";
import { scopedParams } from "../shell/branch-scope.js";
import { ensure, ensureList, scope, settle, type LoaderArgs } from "./scope.js";

/**
 * What MaintenanceScreen reads on every tab (#665): the summary behind the
 * Problems count and the Overview's tiles, every problem for the work-order
 * sheet, and the problem categories.
 */
export async function maintenance(args: LoaderArgs): Promise<void> {
  const { client, slug, branch } = await scope(args);
  await settle(
    ensure(client, maintenanceSummaryQueryOptions(slug, scopedParams({}, branch))),
    ensureList(client, issuesQueryOptions(slug, scopedParams(issueListParams({}), branch))),
    ensure(client, categoriesQueryOptions(slug, "ISSUE_TYPE")),
  );
}

/** The Overview's To do (the open problems, ranked by the screen) and its days off the road (#668). */
export async function maintenanceOverview(args: LoaderArgs): Promise<void> {
  const { client, slug, branch } = await scope(args);
  await settle(
    ensureList(client, issuesQueryOptions(slug, scopedParams(issueListParams({ status: "OPEN" }), branch))),
    ensure(client, fleetUsageQueryOptions(slug, PAGE_USAGE_RANGE, ambientBranchId(branch))),
  );
}

/** The Problems tab under the URL's status. */
export async function maintenanceProblems(args: LoaderArgs & { deps: { status?: IssueStatus | undefined } }): Promise<void> {
  const { client, slug, branch } = await scope(args);
  const { status } = args.deps;
  await ensureList(client, issuesQueryOptions(slug, scopedParams(issueListParams(status === undefined ? {} : { status }), branch)));
}

/** The Work orders tab under the URL's status, or the orders still open. */
export async function maintenanceWorkOrders(
  args: LoaderArgs & { deps: { status?: WorkOrderStatus | undefined; only?: "open" | undefined } },
): Promise<void> {
  const { client, slug, branch } = await scope(args);
  const { status, only } = args.deps;
  await ensureList(
    client,
    workOrdersQueryOptions(
      slug,
      scopedParams<UseWorkOrdersParams>({ ...(status === undefined ? {} : { status }), ...(only === "open" ? { open: true } : {}) }, branch),
    ),
  );
}
