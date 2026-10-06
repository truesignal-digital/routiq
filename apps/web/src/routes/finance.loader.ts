import { assetsQueryOptions } from "../assets/useAssets.js";
import { canApproveEntries, canReadFinance, canReadFinanceEntries } from "../finance/permissions.js";
import { approvalsQueryOptions } from "../finance/useApprovals.js";
import { entriesQueryOptions, type UseEntriesParams } from "../finance/useEntries.js";
import { financeSummaryQueryOptions } from "../finance/useFinanceSummary.js";
import { ambientBranchId } from "../shell/branch-context.js";
import { scopedParams } from "../shell/branch-scope.js";
import { scope, settle, type LoaderArgs } from "./scope.js";

interface MoneySearch {
  status?: string | undefined;
  direction?: string | undefined;
  periodCode?: string | undefined;
  economicMonth?: string | undefined;
  evidence?: string | undefined;
  assetId?: string | undefined;
  view?: string | undefined;
  branch?: "all" | undefined;
}

/**
 * The Money page as FinanceEntriesScreen first asks for it (#314): the tiles,
 * the entries under the URL's lens, the asset filter's first page, and, in the
 * waiting view, the decider's queue as WaitingApprovals presets it.
 */
export async function financeEntries(args: LoaderArgs & { deps: MoneySearch }): Promise<void> {
  const s = await scope(args);
  // The screen reads nothing before this check; a direct link must not either.
  if (!canReadFinanceEntries(s.me?.role, s.me?.enabledModules)) return;
  const { status, direction, economicMonth, assetId, view } = args.deps;
  const periodCode = args.deps.periodCode?.trim() ?? "";
  const evidence = args.deps.evidence === "MISSING" ? "MISSING" : undefined;
  const books = view === "books" && canReadFinance(s.me?.role, s.me?.enabledModules);
  const waiting = view === "waiting" && canApproveEntries(s.me?.role, s.me?.enabledModules);
  // An arrival already widened (`branch=all`) lists every branch; otherwise the shell's agency presets the queue.
  const queueBranch = args.deps.branch === "all" ? undefined : ambientBranchId(s.branch);
  await settle(
    s.client.ensureQueryData(financeSummaryQueryOptions(s.slug, ambientBranchId(s.branch))),
    s.client.ensureInfiniteQueryData(
      entriesQueryOptions(
        s.slug,
        scopedParams<UseEntriesParams>(
          {
            ...(status ? { status } : {}),
            ...(direction ? { direction } : {}),
            ...(periodCode ? { periodCode } : {}),
            ...(economicMonth ? { economicMonth } : {}),
            ...(evidence ? { evidence } : {}),
            ...(assetId ? { assetId } : {}),
            ...(books ? { view: "books" as const } : {}),
            sort: "postedAt:desc",
          },
          s.branch,
        ),
      ),
    ),
    s.client.ensureInfiniteQueryData(assetsQueryOptions(s.slug, scopedParams({}, s.branch))),
    waiting &&
      s.client.ensureInfiniteQueryData(
        approvalsQueryOptions(s.slug, { ...(queueBranch === undefined ? {} : { branchId: queueBranch }), sort: "submittedAt:asc" }),
      ),
  );
}
