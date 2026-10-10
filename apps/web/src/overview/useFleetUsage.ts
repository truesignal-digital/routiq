import { queryOptions, useQuery } from "@tanstack/react-query";
import type { FleetUsageOnTheRoad, FleetUsageResponse, OverviewRange } from "@routiq/contracts";
import { useActiveSession } from "../auth/store.js";
import { authed } from "../lib/list-query.js";
import { useBranchScopedParams, type BranchScopedParams } from "../shell/branch-scope.js";

/** The pages without a range picker (Trucks, Trips, Maintenance) read this month; hook and loader share it. */
export const PAGE_USAGE_RANGE: OverviewRange = "THIS_MONTH";

export async function fetchFleetUsage(
  token: string,
  range: OverviewRange,
  branchId: string | undefined,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<FleetUsageResponse> {
  const params = new URLSearchParams({ range });
  if (branchId !== undefined) params.set("branchId", branchId);
  const response = await fetchImpl(`/v1/assets/usage?${params.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`FLEET_USAGE_${response.status}`);
  const body: unknown = await response.json();
  if (!isFleetUsageResponse(body)) throw new Error("FLEET_USAGE_SHAPE");
  return body;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function isWindow(value: unknown): boolean {
  return isObject(value) && typeof value["from"] === "string" && typeof value["to"] === "string";
}

function isOnTheRoad(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value["tripDays"] === "number" &&
    typeof value["recordedDays"] === "number" &&
    typeof value["notRecordedDays"] === "number"
  );
}

function isVehicle(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value["assetId"] === "string" &&
    typeof value["assetCode"] === "string" &&
    Array.isArray(value["days"]) &&
    (value["period"] === null || isObject(value["period"])) &&
    (value["money"] === null || isObject(value["money"]))
  );
}

/** Structural, like every read here: the server's schema already holds the details. */
export function isFleetUsageResponse(value: unknown): value is FleetUsageResponse {
  if (!isObject(value)) return false;
  const body = value as Partial<Record<keyof FleetUsageResponse, unknown>>;
  const onTheRoad = body.onTheRoad;
  const trips = body.trips;
  return (
    typeof body.range === "string" &&
    typeof body.businessDate === "string" &&
    isWindow(body.period) &&
    isWindow(body.comparison) &&
    Array.isArray(body.boardDays) &&
    Array.isArray(body.vehicles) &&
    body.vehicles.every(isVehicle) &&
    isObject(onTheRoad) &&
    isOnTheRoad(onTheRoad["last"]) &&
    isOnTheRoad(onTheRoad["previous"]) &&
    (body.km === null || isObject(body.km)) &&
    (body.offRoadByMonth === null || Array.isArray(body.offRoadByMonth)) &&
    (body.money === null || (isObject(body.money) && typeof body.money["currency"] === "string")) &&
    (trips === null || (isObject(trips) && Array.isArray(trips["routes"])))
  );
}

/**
 * Km, daily status and cost per km for every vehicle the caller sees (`GET
 * /v1/assets/usage`, #668): the Trucks board, fuel per km on Money, cost per
 * km on the Dashboard, km driven empty on Trips and days off the road on
 * Maintenance. Core, so each of those modules reads it without importing
 * another. Branch-scoped like the money Overview, under the `assets` key.
 */
export function useFleetUsage(range: OverviewRange, enabled = true) {
  const session = useActiveSession();
  const { branchId } = useBranchScopedParams<BranchScopedParams>({});
  return useQuery({
    ...fleetUsageQueryOptions(session?.workspaceSlug, range, branchId),
    enabled: enabled && session !== undefined,
  });
}

/** `branchId` is the shell's: `useBranchScopedParams` in a hook, `ambientBranchId` in a loader. */
export function fleetUsageQueryOptions(workspaceSlug: string | undefined, range: OverviewRange, branchId: string | undefined) {
  return queryOptions({
    queryKey: ["ws", workspaceSlug, "assets", "usage", range, branchId ?? "ALL"],
    enabled: workspaceSlug !== undefined,
    queryFn: authed((token, signal) => fetchFleetUsage(token, range, branchId, signal)),
  });
}

/** A whole percent of `base`; null when there is no base to divide by, never 0. */
export function wholeShare(part: number, base: number): number | null {
  return base > 0 ? Math.round((part / base) * 100) : null;
}

/** Days on a trip ÷ days recorded, as a whole percent; null when no day was recorded. */
export function onTheRoadShare(days: FleetUsageOnTheRoad): number | null {
  return wholeShare(days.tripDays, days.recordedDays);
}

/** "▲ 4" / "▼ 2" / "same" between two whole percents; null when either is not known. */
export function pointsChange(
  current: number | null,
  previous: number | null,
): { kind: "same" } | { kind: "moved"; arrow: "▲" | "▼"; points: number } | null {
  if (current === null || previous === null) return null;
  if (current === previous) return { kind: "same" };
  return { kind: "moved", arrow: current > previous ? "▲" : "▼", points: Math.abs(current - previous) };
}
