import { queryOptions, useQuery } from "@tanstack/react-query";
import { useActiveSession } from "../auth/store.js";
import { authed } from "../lib/list-query.js";
import { REFERENCE_STALE_MS } from "../lib/query-defaults.js";

export interface CategoryOption {
  code: string;
  labelFr: string;
  labelEn: string;
  /** ISSUE_TYPE only: picking this kind of fault pre-checks safety-critical. */
  defaultSafetyCritical?: boolean;
}

export function useCategories(kind: string, enabled = true) {
  const session = useActiveSession();
  const options = categoriesQueryOptions(session?.workspaceSlug, kind);
  return useQuery({ ...options, enabled: session !== undefined && enabled });
}

/** Reference data: a category list changes when an administrator edits it, not between screens. */
export function categoriesQueryOptions(workspaceSlug: string | undefined, kind: string) {
  return queryOptions({
    queryKey: ["ws", workspaceSlug, "categories", kind],
    enabled: workspaceSlug !== undefined,
    staleTime: REFERENCE_STALE_MS,
    queryFn: authed(async (token, signal): Promise<CategoryOption[]> => {
      const response = await fetch(`/v1/categories?kind=${encodeURIComponent(kind)}`, {
        headers: { authorization: `Bearer ${token}` },
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok) throw new Error(`CATEGORIES_${response.status}`);
      const body = (await response.json()) as { categories: CategoryOption[] };
      return body.categories;
    }),
  });
}
