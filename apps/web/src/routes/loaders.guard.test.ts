// @vitest-environment jsdom
import { expect, it } from "vitest";
import { router } from "../router.js";

/**
 * Screens whose first view does not start its reads in a route loader yet, and
 * why. A new screen gets a loader (routes/<screen>.loader.ts, #496) or a line here.
 */
const NO_LOADER: Record<string, string> = {
  "/app/assets/$assetId/details": "reads only the vehicle, which its parent loads",
  "/app/more": "no reads",
  "/app/activities/$activityId": "not yet: #504",
  "/app/activities/record": "not yet: #504",
  "/app/assets/$assetId/documents": "not yet: #504",
  "/app/assets/$assetId/history": "not yet: #504",
  "/app/assets/$assetId/maintenance": "not yet: #504",
  "/app/assets/$assetId/money": "not yet: #504",
  "/app/assets/$assetId/trips": "not yet: #504",
  "/app/assets/new": "not yet: #504",
  "/app/finance/entries/$entryId": "not yet: #504",
  "/app/finance/periods": "not yet: #504",
  "/app/finance/record": "not yet: #504",
  "/app/more/branches": "not yet: #504",
  "/app/more/persons": "not yet: #504",
  "/app/more/users": "not yet: #504",
};

it("every screen in the shell starts its reads in a route loader, or says why not", () => {
  const missing = Object.values(router.routesById)
    .filter((route) => route.id.startsWith("/app/"))
    .filter((route) => route.options.loader === undefined && NO_LOADER[route.id] === undefined)
    .map((route) => route.id)
    .sort();
  expect(missing).toEqual([]);
});

it("lists no screen that has a loader after all", () => {
  const stale = Object.keys(NO_LOADER).filter((id) => router.routesById[id as keyof typeof router.routesById]?.options.loader !== undefined);
  expect(stale).toEqual([]);
});
