// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fetchActivities } from "./useActivities.js";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("fetchActivities", () => {
  it("sends picked dates as dates, for the server to read in the workspace's zone", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [], nextCursor: null }));

    await fetchActivities(
      "token",
      { from: "2026-07-13", to: "2026-07-13", status: "", sort: "startedAt:desc" },
      undefined,
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "/v1/activities?from=2026-07-13&to=2026-07-13&sort=startedAt%3Adesc",
      { headers: { authorization: "Bearer token" } },
    );
  });
});
