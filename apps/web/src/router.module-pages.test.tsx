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
  // The search the page reads: each route's own validation, not the raw address.
  return { pathname: router.state.location.pathname, search: router.state.matches.at(-1)?.search ?? {} };
}

// #665: the list tiles moved into each Overview. A bare page address opens the
// Overview; an old filtered link still lands on the list it filtered.
describe("module pages open on Overview, and old filtered links keep working", () => {
  it.each(["/assets", "/activities", "/maintenance"])("%s opens on its Overview", async (path) => {
    const location = await land(path);
    expect(location.pathname).toBe(path);
    expect(location.search).toEqual({});
  });

  it.each([
    ["/assets?status=ATTENTION", "/assets/list", { status: "ATTENTION" }],
    ["/activities?status=OPEN", "/activities/list", { status: "OPEN" }],
    [
      "/activities?from=2026-10-05&to=2026-10-11",
      "/activities/list",
      { from: "2026-10-05", to: "2026-10-11" },
    ],
    ["/activities?completeness=COMPLETE_WITH_EXCEPTIONS", "/activities/list", { completeness: "COMPLETE_WITH_EXCEPTIONS" }],
    ["/maintenance?tab=issues&issueStatus=OPEN", "/maintenance/problems", { status: "OPEN" }],
    ["/maintenance?tab=issues", "/maintenance/problems", {}],
    ["/maintenance?status=APPROVED", "/maintenance/work-orders", { status: "APPROVED" }],
    ["/maintenance?tab=work-orders", "/maintenance/work-orders", {}],
  ] as const)("%s lands on %s", async (from, pathname, search) => {
    const location = await land(from);
    expect(location.pathname).toBe(pathname);
    expect(location.search).toEqual(search);
  });

  it.each([
    ["/assets/list?availability=GROUNDED", { availability: "GROUNDED" }],
    ["/assets/documents?expiry=DUE_30", { expiry: "DUE_30" }],
    ["/activities/list?missing=fuel", { missing: "fuel" }],
    ["/maintenance/work-orders?only=open", { only: "open" }],
  ] as const)("keeps a tile's filter on %s", async (path, search) => {
    const location = await land(path);
    expect(location.pathname).toBe(path.split("?")[0]);
    expect(location.search).toEqual(search);
  });

  it("drops a filter value no list knows rather than failing the page", async () => {
    const location = await land("/assets/list?availability=PARKED");
    expect(location.pathname).toBe("/assets/list");
    expect(location.search).toEqual({});
  });

  it("still opens a vehicle and a trip by id beside the tabs", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect((await land(`/assets/${id}`)).pathname).toBe(`/assets/${id}`);
    expect((await land(`/activities/${id}`)).pathname).toBe(`/activities/${id}`);
  });
});
