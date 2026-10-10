// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fetchAssets, fetchAssetSummary } from "./api.js";

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

function fakeFetch(
  status: number,
  body: unknown,
  requested: string[] = [],
): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    requested.push(String(url));
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer tok");
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

describe("fetchAssets", () => {
  it("parses the list envelope", async () => {
    const result = await fetchAssets(
      "tok",
      {},
      undefined,
      fakeFetch(200, { items: [validItem], nextCursor: "opaque" }),
    );

    expect(result.items[0]?.assetCode).toBe("DLA-001");
    expect(result.nextCursor).toBe("opaque");
  });

  it("requests the bare path when no filter is set", async () => {
    const requested: string[] = [];
    await fetchAssets(
      "tok",
      {},
      undefined,
      fakeFetch(200, { items: [], nextCursor: null }, requested),
    );

    expect(requested).toEqual(["/v1/assets"]);
  });

  it("sends every filter, repeating status once per lifecycle state", async () => {
    const requested: string[] = [];
    await fetchAssets(
      "tok",
      {
        status: ["UNDER_MAINTENANCE", "RETIRED", "WRITTEN_OFF"],
        category: "TRUCK",
        branchId: "branch-1",
        search: "mercedes actros",
        cursor: "opaque",
        limit: 25,
      },
      undefined,
      fakeFetch(200, { items: [], nextCursor: null }, requested),
    );

    const query = new URLSearchParams(requested[0]!.split("?")[1]);
    expect(query.getAll("status")).toEqual([
      "UNDER_MAINTENANCE",
      "RETIRED",
      "WRITTEN_OFF",
    ]);
    expect(query.get("category")).toBe("TRUCK");
    expect(query.get("branchId")).toBe("branch-1");
    expect(query.get("search")).toBe("mercedes actros");
    expect(query.get("cursor")).toBe("opaque");
    expect(query.get("limit")).toBe("25");
  });

  it("rejects the superseded envelope instead of rendering nothing", async () => {
    await expect(
      fetchAssets(
        "tok",
        {},
        undefined,
        fakeFetch(200, { workspaceId: "ws1", assets: [validItem] }),
      ),
    ).rejects.toThrow("ASSET_LIST_INVALID_RESPONSE");
  });

  it("rejects a missing or mistyped cursor", async () => {
    await expect(
      fetchAssets("tok", {}, undefined, fakeFetch(200, { items: [] })),
    ).rejects.toThrow("ASSET_LIST_INVALID_RESPONSE");
    await expect(
      fetchAssets("tok", {}, undefined, fakeFetch(200, { items: [], nextCursor: 1 })),
    ).rejects.toThrow("ASSET_LIST_INVALID_RESPONSE");
  });

  it("rejects an item with an unknown lifecycle status", async () => {
    await expect(
      fetchAssets(
        "tok",
        {},
        undefined,
        fakeFetch(200, {
          items: [{ ...validItem, lifecycleStatus: "SCRAPPED" }],
          nextCursor: null,
        }),
      ),
    ).rejects.toThrow("ASSET_LIST_INVALID_RESPONSE");
  });

  it("rejects non-ok responses with the status", async () => {
    await expect(
      fetchAssets(
        "tok",
        {},
        undefined,
        fakeFetch(403, { error: { code: "ROLE_FORBIDDEN" } }),
      ),
    ).rejects.toThrow("ASSET_LIST_403");
  });

  it("passes the sort through, since the cursor is keyed on it", async () => {
    const requested: string[] = [];
    await fetchAssets(
      "tok",
      { sort: "assetCode:desc" },
      undefined,
      fakeFetch(200, { items: [], nextCursor: null }, requested),
    );

    expect(new URLSearchParams(requested[0]!.split("?")[1]).get("sort")).toBe(
      "assetCode:desc",
    );
  });
});

describe("fetchAssetSummary", () => {
  const counts = { total: 6, inService: 2, attention: 3 };

  it("parses the fleet counts", async () => {
    const result = await fetchAssetSummary(
      "tok",
      {},
      undefined,
      fakeFetch(200, counts),
    );

    expect(result).toEqual(counts);
  });

  it("requests the bare path when nothing narrows the fleet", async () => {
    const requested: string[] = [];
    await fetchAssetSummary("tok", {}, undefined, fakeFetch(200, counts, requested));

    expect(requested).toEqual(["/v1/assets/summary"]);
  });

  it("narrows by the same filters as the list", async () => {
    const requested: string[] = [];
    await fetchAssetSummary(
      "tok",
      { category: "TRUCK", branchId: "branch-1", search: "actros" },
      undefined,
      fakeFetch(200, counts, requested),
    );

    const query = new URLSearchParams(requested[0]!.split("?")[1]);
    expect(query.get("category")).toBe("TRUCK");
    expect(query.get("branchId")).toBe("branch-1");
    expect(query.get("search")).toBe("actros");
  });

  /** A tile that rendered a partial body would put an unbacked number on screen. */
  it("rejects a body missing a bucket rather than reading it as zero", async () => {
    await expect(
      fetchAssetSummary(
        "tok",
        {},
        undefined,
        fakeFetch(200, { total: 6, inService: 2 }),
      ),
    ).rejects.toThrow("ASSET_SUMMARY_INVALID_RESPONSE");
  });

  it("rejects non-ok responses with the status", async () => {
    await expect(
      fetchAssetSummary(
        "tok",
        {},
        undefined,
        fakeFetch(500, { error: { code: "READ_FAILED" } }),
      ),
    ).rejects.toThrow("ASSET_SUMMARY_500");
  });
});
