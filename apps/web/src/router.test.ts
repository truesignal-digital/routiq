// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { afterEach, describe, expect, it } from "vitest";
import { sessionStore } from "./auth/store.js";
import { router as applicationRouter } from "./router.js";

const identity = { username: "router-test", workspaceSlug: "router-test" };

afterEach(() => {
  sessionStore.logout(identity);
  localStorage.clear();
});

async function land(path: string): Promise<string> {
  sessionStore.save({ ...identity, token: "router-test-token", expiresAt: "2099-01-01T00:00:00Z" });
  const router = createRouter({
    routeTree: applicationRouter.routeTree,
    // No retries: these tests check where a path lands, not the reads its loader starts.
    context: { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return router.state.location.pathname;
}

describe("the More page is gone (#316)", () => {
  it("sends /more to Home", async () => {
    expect(await land("/more")).toBe("/");
  });

  it.each(["/more/persons", "/more/users", "/more/branches", "/my-settings"])(
    "keeps %s where it is",
    async (path) => {
      expect(await land(path)).toBe(path);
    },
  );
});
