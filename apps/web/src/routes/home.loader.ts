import { assetOverviewQueryOptions } from "../assets/useAssetOverview.js";
import { canOpenEntriesList, showsDashboardOverview } from "../dashboard/cards.js";
import { rangeFromParam, type DashboardRangeParam } from "../dashboard/tabs.js";
import { dashboardQueryOptions, HOME_RANGE_DAYS } from "../dashboard/useDashboard.js";
import { comingUpQueryOptions, todoQueryOptions } from "../dashboard/useFleetAttention.js";
import { entriesQueryOptions } from "../finance/useEntries.js";
import { moneyOverviewQueryOptions } from "../overview/useMoneyOverview.js";
import { contributes } from "../modules/manifest.js";
import { ambientBranchId } from "../shell/branch-context.js";
import { scopedParams } from "../shell/branch-scope.js";
import { ensure, ensureList, scope, settle, type LoaderArgs, type Scope } from "./scope.js";

/** Home for the roles without the Dashboard's Overview: its tiles and recent entries. The Overview's tabs load their own. */
export async function home(args: LoaderArgs): Promise<void> {
  const { client, slug, me, branch } = await scope(args);
  if (showsDashboardOverview(me?.role, me?.enabledModules)) return;
  await settle(
    ensure(client, dashboardQueryOptions(slug, HOME_RANGE_DAYS, ambientBranchId(branch))),
    canOpenEntriesList(me?.role, me?.enabledModules) &&
      ensureList(client, entriesQueryOptions(slug, scopedParams({}, branch))),
  );
}

interface RangeSearch {
  range?: DashboardRangeParam | undefined;
}

function moneyRead(s: Scope, range: DashboardRangeParam | undefined) {
  return ensure(s.client, moneyOverviewQueryOptions(s.slug, rangeFromParam(range), ambientBranchId(s.branch)));
}

/** Dashboard › Overview (#666): the money read for the range, To do, Coming up and the fleet counts. */
export async function dashboardOverview(args: LoaderArgs & { deps: RangeSearch }): Promise<void> {
  const s = await scope(args);
  if (!showsDashboardOverview(s.me?.role, s.me?.enabledModules)) return;
  await settle(
    moneyRead(s, args.deps.range),
    ensure(s.client, todoQueryOptions(s.slug)),
    ensure(s.client, comingUpQueryOptions(s.slug, 14)),
    contributes("homeCards", "assets", s.me?.enabledModules) &&
      ensure(s.client, assetOverviewQueryOptions(s.slug, scopedParams({}, s.branch))),
  );
}

/** Dashboard › To do: every row, the whole Branch Scope. */
export async function dashboardTodo(args: LoaderArgs): Promise<void> {
  const s = await scope(args);
  if (!showsDashboardOverview(s.me?.role, s.me?.enabledModules)) return;
  await settle(ensure(s.client, todoQueryOptions(s.slug)));
}

/** Dashboard › Profit by vehicle and Profit by branch: the money read for the range. */
export async function dashboardMoney(args: LoaderArgs & { deps: RangeSearch }): Promise<void> {
  const s = await scope(args);
  if (!showsDashboardOverview(s.me?.role, s.me?.enabledModules)) return;
  await settle(moneyRead(s, args.deps.range));
}
