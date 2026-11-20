import { plateKey } from "@routiq/contracts";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { sessionStore, useActiveSession } from "@/auth/store.js";
import { fetchAssets } from "../api.js";

/** The list read's ceiling; an import tops out at 500 rows, the fleet is a few hundred. */
const PAGE = 100;
const MAX_PAGES = 50;

export interface ExistingAssets {
  assetCodes: Set<string>;
  plates: Set<string>;
}

/**
 * Codes and plates the member can already see, so the preview can say "already
 * registered" before sending. Branch scope may hide some; the server's
 * duplicate checks answer for those row by row.
 */
export function existingAssetsQueryOptions(workspaceSlug: string | undefined) {
  return queryOptions({
    queryKey: ["ws", workspaceSlug, "assets", "import-identities"] as const,
    enabled: workspaceSlug !== undefined,
    queryFn: async ({ signal }): Promise<ExistingAssets> => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      const found: ExistingAssets = { assetCodes: new Set(), plates: new Set() };
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await fetchAssets(token, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }, signal);
        for (const asset of response.items) {
          found.assetCodes.add(asset.assetCode);
          if (asset.registrationNumber !== null) found.plates.add(plateKey(asset.registrationNumber));
        }
        if (response.nextCursor === null) break;
        cursor = response.nextCursor;
      }
      return found;
    },
  });
}

export function useExistingAssets() {
  return useQuery(existingAssetsQueryOptions(useActiveSession()?.workspaceSlug));
}
