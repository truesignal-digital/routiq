import type { EnsureInfiniteQueryDataOptions, EnsureQueryDataOptions, QueryClient, QueryKey } from "@tanstack/react-query";
import { assetRegistrationReferenceQueryOptions } from "../assets/reference.js";
import { meQueryOptions, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { ALL_BRANCHES, readStoredBranch, resolveCurrentBranchId, type CurrentBranchId } from "../shell/branch-context.js";

/**
 * Route loaders (#496): each starts the reads a screen's first view makes,
 * with the params and keys the screen's own hooks use, so the data downloads
 * alongside the screen's code instead of after it renders, and the screen
 * mounts on a filled cache. A read that fails here is left to the screen,
 * which shows its own error and retry; a loader never fails a navigation.
 *
 * One small module per screen, loaded on demand (router.tsx): a screen's
 * loader waits on its own code only, and the sign-in page carries none.
 */

export interface LoaderArgs {
  context: { queryClient: QueryClient };
}

export interface Scope {
  client: QueryClient;
  slug: string | undefined;
  me: MeContext | undefined;
  branch: CurrentBranchId;
}

/** The member and the shell's branch, resolved as BranchProvider resolves them. */
export async function scope({ context }: LoaderArgs): Promise<Scope> {
  const client = context.queryClient;
  const session = sessionStore.getActive();
  const slug = session?.workspaceSlug;
  const reference = assetRegistrationReferenceQueryOptions(slug);
  const [me, branches] = await Promise.all([
    client.ensureQueryData(meQueryOptions(client, session)).catch(() => undefined),
    client.ensureQueryData({ ...reference, retry: retries(client, reference) }).catch(() => undefined),
  ]);
  const branch =
    branches === undefined
      ? ALL_BRANCHES
      : resolveCurrentBranchId(readStoredBranch(slug), branches.branches, "ready");
  return { client, slug, me, branch };
}

/**
 * ensureQueryData alone tries once (fetchQuery's default); a loader makes the
 * read's own attempts, or the client's default, as the screen's hook would.
 */
function retries<T extends { retry?: unknown }>(client: QueryClient, options: T): NonNullable<T["retry"]> {
  // The client's default is typed for its own error type; the read's error type is no narrower.
  return (options.retry ?? client.getDefaultOptions().queries?.retry ?? 3) as NonNullable<T["retry"]>;
}

export function ensure<TQueryFnData, TError, TData, TQueryKey extends QueryKey>(
  client: QueryClient,
  options: EnsureQueryDataOptions<TQueryFnData, TError, TData, TQueryKey>,
): Promise<unknown> {
  return client.ensureQueryData({ ...options, retry: retries(client, options) });
}

export function ensureList<TQueryFnData, TError, TData, TQueryKey extends QueryKey, TPageParam>(
  client: QueryClient,
  options: EnsureInfiniteQueryDataOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>,
): Promise<unknown> {
  return client.ensureInfiniteQueryData({ ...options, retry: retries(client, options) });
}

export async function settle(...reads: Array<Promise<unknown> | false | undefined>): Promise<void> {
  await Promise.allSettled(reads.filter((read): read is Promise<unknown> => read instanceof Promise));
}
