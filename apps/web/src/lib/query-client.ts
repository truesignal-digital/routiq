import { QueryClient } from "@tanstack/react-query";
import { retryRead } from "./query-retry.js";

/**
 * The app's one Query cache, shared by the router's loaders and the screens'
 * hooks, so data a loader fetched is the data a screen reads. The Query cache
 * is not offline storage (§8): no persistence plugin. Reads keep the default
 * networkMode: offline they pause, and the screens say so (#576) until the
 * connection returns.
 */
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: retryRead } } });
