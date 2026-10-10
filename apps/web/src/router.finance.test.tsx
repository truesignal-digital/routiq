// @vitest-environment jsdom
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
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return router.state.location;
}

describe("/finance/approvals (#314, #664)", () => {
  it("lands on the Money page's To approve tab, so old links keep working", async () => {
    const location = await land("/finance/approvals");
    expect(location.pathname).toBe("/finance/approve");
    expect(location.search).toEqual({});
  });

  it("keeps an overflow line's widening", async () => {
    const location = await land("/finance/approvals?branch=all");
    expect(location.pathname).toBe("/finance/approve");
    expect(location.search).toEqual({ branch: "all" });
  });
});

describe("/finance/entries?view=waiting (#664)", () => {
  it("lands on To approve: the waiting view became a tab", async () => {
    const location = await land("/finance/entries?view=waiting&branch=all");
    expect(location.pathname).toBe("/finance/approve");
    expect(location.search).toEqual({ branch: "all" });
  });

  it("leaves the books view on Entries", async () => {
    const location = await land("/finance/entries?view=books");
    expect(location.pathname).toBe("/finance/entries");
    expect(location.search).toEqual({ view: "books" });
  });
});

describe("/finance (#664)", () => {
  it("is the Money page's Overview, its range in the address", async () => {
    const location = await land("/finance?range=3-months");
    expect(location.pathname).toBe("/finance");
    expect(location.search).toEqual({ range: "3-months" });
  });

  it("drops a range it does not know rather than failing the page", async () => {
    sessionStore.save({ ...identity, token: "token", expiresAt: "2099-01-01T00:00:00Z" });
    const router = createRouter({
      routeTree: applicationRouter.routeTree,
      history: createMemoryHistory({ initialEntries: ["/finance?range=forever"] }),
    });
    await router.load();
    expect(router.state.matches.at(-1)?.search).toEqual({});
  });
});
