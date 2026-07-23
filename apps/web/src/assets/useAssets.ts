import { useQuery } from "@tanstack/react-query";
import { sessionStore, useActiveSession } from "../auth/store.js";
import { fetchAssets } from "./api.js";
import type { AssetListItem } from "./model.js";

interface UseAssetsResult {
  status: "loading" | "ready" | "error";
  assets: AssetListItem[];
  retry: () => void;
}

export function useAssets(): UseAssetsResult {
  const session = useActiveSession();

  const query = useQuery({
    // Workspace-scoped key: the cache can never leak across a workspace switch.
    queryKey: ["ws", session?.workspaceSlug, "assets"],
    enabled: session !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchAssets(token, signal);
    },
  });

  return {
    status: query.isPending ? "loading" : query.isError ? "error" : "ready",
    assets: query.data?.assets ?? [],
    retry: () => void query.refetch(),
  };
}
