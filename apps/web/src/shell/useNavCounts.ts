import { useQueries } from "@tanstack/react-query";
import {
  waitsOn,
  type ModuleCode,
  type NavCountKey,
  type NavCountsResponse,
  type Role,
  type ToggleableModuleCode,
} from "@routiq/contracts";
import { useMeContext } from "../auth/me.js";
import { sessionStore, useActiveSession } from "../auth/store.js";
import { installedModules } from "../modules/manifest.js";

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

interface CountSource {
  key: NavCountKey;
  module: ToggleableModuleCode;
  /** The list the count belongs to; its invalidations reach the count. */
  listKey: (slug: string | undefined) => unknown[];
}

/** Every count comes with the manifest of the module whose list it counts. */
function countSources(): CountSource[] {
  return installedModules().flatMap((manifest) =>
    manifest.navCounts.map((count) => ({ ...count, module: manifest.code })),
  );
}

/**
 * The counts that apply to this viewer: the owning module on and the role
 * one the count waits on. A render hint only: the server answers null for a
 * role that does not act.
 */
export function applicableCounts(
  role: Role | undefined,
  enabledModules: readonly ModuleCode[] | undefined,
): CountSource[] {
  if (role === undefined || enabledModules === undefined) return [];
  return countSources().filter((source) => enabledModules.includes(source.module) && waitsOn(source.key, role));
}

/**
 * What waits on the viewer, counted by the server (`GET /v1/nav-counts`). The
 * sidebar and the phone bottom bar both read it; the browser never counts rows.
 * A key is present only when its count is above zero.
 */
export function useNavCounts(): NavCounts {
  const session = useActiveSession();
  const me = useMeContext();
  const slug = session?.workspaceSlug;
  // A count that does not apply creates no query, so a signed-out shell keeps
  // nothing in the cache.
  const sources = session === undefined ? [] : applicableCounts(me?.role, me?.enabledModules);
  const results = useQueries({
    queries: sources.map(({ key, listKey }) => ({
      queryKey: [...listKey(slug), "nav-count"],
      queryFn: sharedFetch,
      select: (counts: NavCountsResponse) => counts[key],
    })),
  });

  const counts: NavCounts = {};
  sources.forEach(({ key }, index) => {
    const value = results[index]?.data;
    if (typeof value === "number" && value > 0) counts[key] = value;
  });
  return counts;
}
