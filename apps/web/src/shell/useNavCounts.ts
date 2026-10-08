import { useQueries } from "@tanstack/react-query";
import { waitsOn, type ModuleCode, type NavCountKey, type NavCountsResponse } from "@routiq/contracts";
import { useMeContext } from "../auth/me.js";
import { sessionStore, useActiveSession } from "../auth/store.js";
import { maintenanceQueryKey } from "../maintenance/useMaintenance.js";

export type NavCounts = Partial<Record<NavCountKey, number>>;

function isCount(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

export function isNavCounts(value: unknown): value is NavCountsResponse {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return isCount(body.moneyWaiting) && isCount(body.maintenanceNew);
}

export async function fetchNavCounts(token: string, fetchImpl: typeof fetch = fetch): Promise<NavCountsResponse> {
  const response = await fetchImpl("/v1/nav-counts", { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`NAV_COUNTS_${response.status}`);
  const body: unknown = await response.json();
  if (!isNavCounts(body)) throw new Error("NAV_COUNTS_SHAPE");
  return body;
}

/**
 * Each count lives under the key of the list it counts, so the invalidation a
 * decision or a new report already sends to that list refreshes its count too.
 * Both read the same response; a refresh that hits both shares one request.
 */
let inflight: Promise<NavCountsResponse> | undefined;

function sharedFetch(): Promise<NavCountsResponse> {
  const token = sessionStore.getToken();
  if (token === undefined) return Promise.reject(new Error("AUTH_REQUIRED"));
  inflight ??= fetchNavCounts(token).finally(() => {
    inflight = undefined;
  });
  return inflight;
}

const NAV_COUNT_KEYS = ["moneyWaiting", "maintenanceNew"] as const satisfies readonly NavCountKey[];

/** The list each count belongs to; its invalidations reach the count. */
const LIST_KEY: Record<NavCountKey, (slug: string | undefined) => unknown[]> = {
  moneyWaiting: (slug) => ["ws", slug, "finance", "approvals"],
  maintenanceNew: maintenanceQueryKey,
};

const MODULE_OF: Record<NavCountKey, ModuleCode> = {
  moneyWaiting: "FINANCE",
  maintenanceNew: "MAINTENANCE",
};

/**
 * What waits on the viewer, counted by the server (`GET /v1/nav-counts`). The
 * sidebar and the phone bottom bar both read it; the browser never counts rows.
 * A key is present only when its count is above zero.
 */
export function useNavCounts(): NavCounts {
  const session = useActiveSession();
  const me = useMeContext();
  const slug = session?.workspaceSlug;
  // A render hint only: the server answers null for a role that does not act.
  // A count that does not apply creates no query, so a signed-out shell keeps
  // nothing in the cache.
  const keys = NAV_COUNT_KEYS.filter(
    (key) =>
      session !== undefined &&
      me !== undefined &&
      me.enabledModules.includes(MODULE_OF[key]) &&
      waitsOn(key, me.role),
  );
  const results = useQueries({
    queries: keys.map((key) => ({
      queryKey: [...LIST_KEY[key](slug), "nav-count"],
      queryFn: sharedFetch,
      select: (counts: NavCountsResponse) => counts[key],
    })),
  });

  const counts: NavCounts = {};
  keys.forEach((key, index) => {
    const value = results[index]?.data;
    if (typeof value === "number" && value > 0) counts[key] = value;
  });
  return counts;
}
