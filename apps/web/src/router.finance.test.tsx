// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { afterEach, describe, expect, it } from "vitest";
import { sessionStore } from "./auth/store.js";
import { router as applicationRouter } from "./router.js";

const identity = { username: "router-test", workspaceSlug: "router-test" };

afterEach(() => sessionStore.logout(identity));

async function land(path: string) {
  sessionStore.save({ ...identity, token: "token", expiresAt: "2099-01-01T00:00:00Z" });
  const router = createRouter({
    routeTree: applicationRouter.routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return router.state.location;
}

describe("/finance/approvals (#314)", () => {
  it("lands on the Money page's waiting view, so old links keep working", async () => {
    const location = await land("/finance/approvals");
    expect(location.pathname).toBe("/finance/entries");
    expect(location.search).toEqual({ view: "waiting" });
  });

  it("keeps an overflow line's widening", async () => {
    const location = await land("/finance/approvals?branch=all");
    expect(location.pathname).toBe("/finance/entries");
    expect(location.search).toEqual({ view: "waiting", branch: "all" });
  });
});
