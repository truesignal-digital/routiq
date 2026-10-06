import { assetsQueryOptions } from "../assets/useAssets.js";
import { canApproveEntries, canManagePeriods, canReadFinanceEntries } from "../finance/permissions.js";
import { approvalsQueryOptions } from "../finance/useApprovals.js";
import { entriesQueryOptions, type UseEntriesParams } from "../finance/useEntries.js";
import { ambientBranchId } from "../shell/branch-context.js";
import { scopedParams } from "../shell/branch-scope.js";
import { scope, settle, type LoaderArgs, type Scope } from "./scope.js";

interface EntriesSearch {
  status?: string | undefined;
  direction?: string | undefined;
  periodCode?: string | undefined;
  assetId?: string | undefined;
}

/** FinanceNav's pending count, on every finance screen for those who manage periods. */
function pendingCount(s: Scope): Promise<unknown> | false {
  return canManagePeriods(s.me?.role, s.me?.enabledModules) && s.client.ensureInfiniteQueryData(approvalsQueryOptions(s.slug, {}));
}

export async function financeEntries(args: LoaderArgs & { deps: EntriesSearch }): Promise<void> {
  const s = await scope(args);
  // The screen reads nothing before this check; a direct link must not either.
  if (!canReadFinanceEntries(s.me?.role, s.me?.enabledModules)) return;
  const { status, direction, assetId } = args.deps;
  const periodCode = args.deps.periodCode?.trim() ?? "";
  await settle(
    s.client.ensureInfiniteQueryData(
      entriesQueryOptions(
        s.slug,
        scopedParams<UseEntriesParams>(
          {
            ...(status ? { status } : {}),
            ...(direction ? { direction } : {}),
            ...(periodCode ? { periodCode } : {}),
            ...(assetId ? { assetId } : {}),
            sort: "postedAt:desc",
          },
          s.branch,
        ),
      ),
    ),
    s.client.ensureInfiniteQueryData(assetsQueryOptions(s.slug, scopedParams({}, s.branch))),
    pendingCount(s),
  );
}

export async function financeApprovals(args: LoaderArgs & { deps: { branch?: "all" | undefined } }): Promise<void> {
  const s = await scope(args);
  // The queue presets its own visible filter from the shell's branch, unless it arrived widened.
  const branchId = args.deps.branch === "all" ? undefined : ambientBranchId(s.branch);
  await settle(
    canApproveEntries(s.me?.role, s.me?.enabledModules) &&
      s.client.ensureInfiniteQueryData(
        approvalsQueryOptions(s.slug, { ...(branchId === undefined ? {} : { branchId }), sort: "submittedAt:asc" }),
      ),
    pendingCount(s),
  );
}
