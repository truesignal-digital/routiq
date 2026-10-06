import { QueryClient } from "@tanstack/react-query";
import { QUERY_DEFAULTS } from "./query-defaults.js";

/**
 * The app's one Query cache, shared by the router's loaders and the screens'
 * hooks, so data a loader fetched is the data a screen reads. The Query cache
 * is not offline storage (§8): no persistence plugin.
 */
export const queryClient = new QueryClient({ defaultOptions: { queries: QUERY_DEFAULTS } });
