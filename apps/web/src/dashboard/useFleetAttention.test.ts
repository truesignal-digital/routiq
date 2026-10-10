import { describe, expect, it, vi } from "vitest";
import { fetchComingUp, fetchTodo, isComingUpResponse, isTodoResponse } from "./useFleetAttention.js";

const scope = { ambientBranch: "IGNORED", branchIds: "ALL" };
const row = { code: "VEHICLE_GROUNDED", link: { kind: "asset", id: "a1", number: null }, params: {} };

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("fleet attention reads", () => {
  it("accepts the To do and Coming up shapes and refuses a body missing its rows or count", () => {
    expect(isTodoResponse({ businessDate: "2026-10-09", scope, rows: [row], totalCount: 1 })).toBe(true);
    expect(isTodoResponse({ businessDate: "2026-10-09", scope, rows: [row] })).toBe(false);
    expect(
      isComingUpResponse({ businessDate: "2026-10-09", windowDays: 14, scope, rows: [], totalCount: 0, notCounted: [] }),
    ).toBe(true);
    expect(isComingUpResponse({ businessDate: "2026-10-09", windowDays: 14, scope, rows: [], totalCount: 0 })).toBe(false);
  });

  it("asks the server for the window and names a refusal by its status", async () => {
    const fetchImpl = vi.fn(async () =>
      response({ businessDate: "2026-10-09", windowDays: 30, scope, rows: [], totalCount: 0, notCounted: [] }),
    );
    await fetchComingUp("token", 30, undefined, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("/v1/coming-up?days=30", { headers: { authorization: "Bearer token" } });
    await expect(fetchTodo("token", undefined, async () => response({}, 403))).rejects.toThrow("TODO_403");
    await expect(fetchTodo("token", undefined, async () => response({ rows: [] }))).rejects.toThrow("TODO_SHAPE");
  });
});
