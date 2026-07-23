import { describe, expect, it } from "vitest";
import { fetchAssets } from "./api.js";

const validItem = {
  id: "a1",
  assetCode: "DLA-001",
  registrationNumber: null,
  manufacturer: "Mercedes",
  model: "Actros",
  lifecycleStatus: "IN_SERVICE",
  rowVersion: 1,
  category: { code: "TRUCK", labelFr: "Camion", labelEn: "Truck" },
  branch: { code: "DLA", name: "Douala" },
};

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer tok");
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

describe("fetchAssets", () => {
  it("parses a valid response", async () => {
    const result = await fetchAssets(
      "tok",
      undefined,
      fakeFetch(200, { workspaceId: "ws1", assets: [validItem] }),
    );
    expect(result.assets[0]?.assetCode).toBe("DLA-001");
  });

  it("rejects a malformed body instead of rendering garbage", async () => {
    await expect(
      fetchAssets("tok", undefined, fakeFetch(200, { nonsense: true })),
    ).rejects.toThrow("ASSET_LIST_INVALID_RESPONSE");
  });

  it("rejects non-ok responses with the status", async () => {
    await expect(
      fetchAssets("tok", undefined, fakeFetch(403, { error: { code: "ROLE_FORBIDDEN" } })),
    ).rejects.toThrow("ASSET_LIST_403");
  });
});
