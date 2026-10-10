import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SUMMARY_SCHEDULES, type CompanySettingsResponse } from "@routiq/contracts";
import { sessionStore, useActiveSession } from "../auth/store.js";

const SCHEDULES: ReadonlySet<string> = new Set(SUMMARY_SCHEDULES);

export function isCompanySettingsResponse(value: unknown): value is CompanySettingsResponse {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body["summarySchedule"] === "string" &&
    SCHEDULES.has(body["summarySchedule"]) &&
    typeof body["version"] === "number"
  );
}

export async function fetchCompanySettings(
  token: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<CompanySettingsResponse> {
  const response = await fetchImpl("/v1/company-settings", {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`COMPANY_SETTINGS_${response.status}`);
  const body: unknown = await response.json();
  if (!isCompanySettingsResponse(body)) throw new Error("COMPANY_SETTINGS_SHAPE");
  return body;
}

export function companySettingsKey(workspaceSlug: string | undefined) {
  return ["ws", workspaceSlug, "company-settings"] as const;
}

/** The company-wide settings no module owns (#669), for Direction. */
export function useCompanySettings() {
  const session = useActiveSession();
  return useQuery({
    queryKey: companySettingsKey(session?.workspaceSlug),
    enabled: session !== undefined,
    queryFn: ({ signal }) => {
      const token = sessionStore.getToken();
      if (token === undefined) throw new Error("AUTH_REQUIRED");
      return fetchCompanySettings(token, signal);
    },
  });
}

/**
 * After a change: the settings, and every Overview, whose notice follows the
 * schedule. The Overviews refetch when next shown.
 */
export function useInvalidateCompanySettings() {
  const queryClient = useQueryClient();
  const workspaceSlug = useActiveSession()?.workspaceSlug;
  return () => queryClient.invalidateQueries({ queryKey: ["ws", workspaceSlug] });
}
