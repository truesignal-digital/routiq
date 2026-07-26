// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionStore } from "../auth/store.js";
import { useAssets, type UseAssetsParams } from "./useAssets.js";

function item(assetCode: string) {
  return {
    id: `id-${assetCode}`,
    assetCode,
    registrationNumber: null,
    manufacturer: "Mercedes",
    model: "Actros",
    lifecycleStatus: "IN_SERVICE",
    rowVersion: 1,
    category: { code: "TRUCK", labelFr: "Camion", labelEn: "Truck" },
    branch: { code: "DLA", name: "Douala" },
  };
}

/** Serves one canned body per call, recording the URL the hook asked for. */
function stubFetch(bodies: unknown[]) {
  const requested: string[] = [];
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      requested.push(String(url));
      const body = bodies[Math.min(call, bodies.length - 1)];
      call += 1;
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return requested;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderUseAssets(params: UseAssetsParams = {}) {
  return renderHook(() => useAssets(params), { wrapper });
}

describe("useAssets", () => {
  beforeEach(() => {
    sessionStore.save({
      username: "ada",
      workspaceSlug: "ws-1",
      token: "tok",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStore.logout({ username: "ada", workspaceSlug: "ws-1" });
  });

  it("loads the first page with no filter in the query string", async () => {
    const requested = stubFetch([{ items: [item("AST-001")], nextCursor: null }]);

    const { result } = renderUseAssets();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requested).toEqual(["/v1/assets"]);
    expect(result.current.data?.pages[0]?.items[0]?.assetCode).toBe("AST-001");
  });

  it("passes search and lifecycle filters to the server", async () => {
    const requested = stubFetch([{ items: [], nextCursor: null }]);

    const { result } = renderUseAssets({
      search: "actros",
      status: ["UNDER_MAINTENANCE", "RETIRED", "WRITTEN_OFF"],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const query = new URLSearchParams(requested[0]!.split("?")[1]);
    expect(query.get("search")).toBe("actros");
    expect(query.getAll("status")).toEqual([
      "UNDER_MAINTENANCE",
      "RETIRED",
      "WRITTEN_OFF",
    ]);
  });

  it("walks the cursor, appending pages without duplicates", async () => {
    const requested = stubFetch([
      { items: [item("AST-001"), item("AST-002")], nextCursor: "page-2" },
      { items: [item("AST-003")], nextCursor: null },
    ]);

    const { result } = renderUseAssets({ search: "actros" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();

    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    const codes = result.current.data!.pages.flatMap((page) =>
      page.items.map((asset) => asset.assetCode),
    );
    expect(codes).toEqual(["AST-001", "AST-002", "AST-003"]);
    expect(codes).toEqual([...new Set(codes)]);

    // The cursor rides along; the filter is not dropped on the second page.
    const second = new URLSearchParams(requested[1]!.split("?")[1]);
    expect(second.get("cursor")).toBe("page-2");
    expect(second.get("search")).toBe("actros");
  });

  it("surfaces an error rather than an empty list when the body is malformed", async () => {
    stubFetch([{ workspaceId: "ws-1", assets: [item("AST-001")] }]);

    const { result } = renderUseAssets();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
