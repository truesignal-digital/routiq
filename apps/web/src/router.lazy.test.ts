import { describe, expect, it, vi } from "vitest";
import { AFTER_SIGN_IN, preloadScreens, router, SCREENS_BY_USE } from "./router.js";

type RouteComponent = { preload?: () => Promise<void> };

const routes = Object.values(router.routesById) as unknown as Array<{
  id: string;
  options: { component?: RouteComponent; pendingComponent?: unknown };
}>;
const withScreen = routes.filter((route) => route.options.component !== undefined);

// #480: only sign-in may ship in the first download; a route added with a
// static import would quietly put its screen back into it.
describe("routes load on demand", () => {
  it("gives every screen but sign-in a lazy component", () => {
    const eager = withScreen
      .filter((route) => typeof route.options.component?.preload !== "function")
      .map((route) => route.id);
    expect(eager).toEqual(["/login"]);
  });

  it("preloads every lazy screen exactly once, so moving around never waits on a download", () => {
    const preloaded = [...AFTER_SIGN_IN, ...SCREENS_BY_USE];
    expect(new Set(preloaded).size).toBe(preloaded.length);
    const lazy = withScreen
      .filter((route) => route.id !== "/login")
      .map((route) => route.options.component);
    expect(new Set(preloaded)).toEqual(new Set(lazy));
  });

  it("holds the background fetch while the app is loading something of its own", async () => {
    vi.useFakeTimers();
    try {
      const spies = SCREENS_BY_USE.map((screen) => vi.spyOn(screen, "preload").mockResolvedValue(undefined));
      let busy = true;
      const done = preloadScreens(() => busy);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(spies[0]).not.toHaveBeenCalled();
      busy = false;
      await vi.advanceTimersByTimeAsync(250);
      await done;
      for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("keeps a vehicle section's fallback inside the workspace frame", () => {
    const sections = routes.filter((route) => route.id.startsWith("/app/assets/$assetId/"));
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) expect(section.options.pendingComponent, section.id).toBeDefined();
  });
});
