// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fetchApprovalChain } from "./useApprovalChain.js";

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("fetchApprovalChain", () => {
  it("reads /v1/approval-chain with the bearer token", async () => {
    const body = { currency: "XAF", chains: [], notice: null };
    const fetchImpl = vi.fn(async () => jsonResponse(body));
    await expect(fetchApprovalChain("tok", undefined, fetchImpl)).resolves.toEqual(body);
    expect(fetchImpl).toHaveBeenCalledWith("/v1/approval-chain", {
      headers: { authorization: "Bearer tok" },
    });
  });

  it("fails loudly on an error status or a drifted shape", async () => {
    await expect(fetchApprovalChain("tok", undefined, async () => jsonResponse({}, 500))).rejects.toThrow(
      "APPROVAL_CHAIN_500",
    );
    await expect(
      fetchApprovalChain("tok", undefined, async () => jsonResponse({ chains: "nope" })),
    ).rejects.toThrow("APPROVAL_CHAIN_SHAPE");
  });
});
