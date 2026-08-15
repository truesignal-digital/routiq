// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";
import { sessionStore } from "../auth/store.js";
import { ALL_BRANCHES, BranchProvider, branchStorageKey } from "../shell/branch-context.js";
import { useAssetOptions } from "./useAssetOptions.js";

const DLA = { id: "branch-dla", code: "DLA", name: "Douala" };
const YDE = { id: "branch-yde", code: "YDE", name: "Yaoundé" };

const REFERENCE = { assetClasses: [], branches: [DLA, YDE] };

function asset(assetCode: string, branch: typeof DLA) {
  return {
    id: `id-${assetCode}`,
    assetCode,
    registrationNumber: null,
    manufacturer: "Mercedes",
    model: "Actros",
    lifecycleStatus: "IN_SERVICE",
    rowVersion: 1,
    category: { code: "TRUCK", labelFr: "Camion", labelEn: "Truck" },
    branch: { code: branch.code, name: branch.name },
  };
}

const FLEET = [asset("AST-001", DLA), asset("AST-002", YDE)];
const BRANCH_BY_ID = new Map([DLA, YDE].map((branch) => [branch.id, branch.code]));

/** `/v1/assets` narrows server-side, so the stub does too. */
function stubFetch() {
  const listed: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.startsWith("/v1/reference/asset-registration")) {
        return new Response(JSON.stringify(REFERENCE), { status: 200 });
      }
      if (href.startsWith("/v1/assets")) {
        listed.push(href);
        const branchId = new URLSearchParams(href.split("?")[1]).get("branchId");
        const code = branchId === null ? undefined : BRANCH_BY_ID.get(branchId);
        const items =
          branchId === null ? FLEET : FLEET.filter((row) => row.branch.code === code);
        return new Response(JSON.stringify({ items, nextCursor: null }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 200 });
    }),
  );
  return listed;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <BranchProvider>{children}</BranchProvider>
    </QueryClientProvider>
  );
}

describe("asset picker options under the shell's current branch", () => {
  beforeEach(() => {
    sessionStore.save({
      username: "ada",
      workspaceSlug: "ws-1",
      token: "tok",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    localStorage.setItem(branchStorageKey("ws-1"), DLA.id);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem(branchStorageKey("ws-1"));
    sessionStore.logout({ username: "ada", workspaceSlug: "ws-1" });
  });

  it("follows the lens when the caller names no branch", async () => {
    const listed = stubFetch();

    const { result } = renderHook(() => useAssetOptions(), { wrapper });

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]?.value).toBe("id-AST-001");
    await waitFor(() =>
      expect(new URLSearchParams(listed[0]!.split("?")[1]).get("branchId")).toBe(
        DLA.id,
      ),
    );
  });

  it("offers the whole scope when the caller asks for every branch", async () => {
    const listed = stubFetch();

    const { result } = renderHook(() => useAssetOptions(ALL_BRANCHES), { wrapper });

    // A command form may charge a cost to a truck from the agency next door: the
    // ambient branch narrows collections, never what a command may reference.
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current.map((option) => option.value)).toEqual([
      "id-AST-001",
      "id-AST-002",
    ]);
    // `ALL_BRANCHES` is a sentinel, not a filter — it must never reach the API.
    for (const href of listed) {
      expect(new URLSearchParams(href.split("?")[1]).get("branchId")).toBeNull();
    }
  });
});
