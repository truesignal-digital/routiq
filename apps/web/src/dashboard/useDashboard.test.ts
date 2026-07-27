// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { DashboardResponse } from "@routiq/contracts";
import { fetchDashboard } from "./useDashboard.js";

const RESPONSE: DashboardResponse = {
  assets: {
    total: 12,
    byStatus: {
      REGISTERED: 2,
      IN_SERVICE: 9,
      UNDER_MAINTENANCE: 1,
      SOLD: 0,
      RETIRED: 0,
      WRITTEN_OFF: 0,
    },
  },
  openPeriod: {
    periodCode: "2026-07",
    postedExpenseMinor: 450000,
    postedRevenueMinor: 1200000,
    currency: "XAF",
  },
  pendingApprovals: { count: 3 },
  series: [
    { date: "2026-07-25", expenseMinor: 0, revenueMinor: 0 },
    { date: "2026-07-26", expenseMinor: 15000, revenueMinor: 42000 },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("fetchDashboard", () => {
  it("asks for the requested window and carries the bearer token", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(RESPONSE));

    await fetchDashboard("token-abc", 30, undefined, fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledWith("/v1/dashboard?days=30", {
      headers: { authorization: "Bearer token-abc" },
    });
  });

  it("returns the aggregate exactly as the API computed it", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(RESPONSE));

    const result = await fetchDashboard(
      "token",
      90,
      undefined,
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual(RESPONSE);
  });

  it("surfaces the status code so the screen can show its own banner", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: "READ_FAILED" } }, 500));

    await expect(
      fetchDashboard("token", 90, undefined, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("DASHBOARD_500");
  });

  it("refuses a payload that drifted from the contract instead of rendering it", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ...RESPONSE, series: undefined }),
    );

    await expect(
      fetchDashboard("token", 90, undefined, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow();
  });
});
