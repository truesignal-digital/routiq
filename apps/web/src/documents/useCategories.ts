import { useQuery } from "@tanstack/react-query";
import { sessionStore, useActiveSession } from "../auth/store.js";

export interface CategoryOption {
  code: string;
  labelFr: string;
  labelEn: string;
  /** ISSUE_TYPE only: picking this kind of fault pre-checks safety-critical. */
  defaultSafetyCritical?: boolean;
}

export function useCategories(kind: string, enabled = true) {
  const session = useActiveSession();
  return useQuery({
    queryKey: ["ws", session?.workspaceSlug, "categories", kind],
    enabled: session !== undefined && enabled,
    queryFn: async ({ signal }): Promise<CategoryOption[]> => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      const response = await fetch(`/v1/categories?kind=${encodeURIComponent(kind)}`, {
        headers: { authorization: `Bearer ${token}` },
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok) throw new Error(`CATEGORIES_${response.status}`);
      const body = (await response.json()) as { categories: CategoryOption[] };
      return body.categories;
    },
  });
}
