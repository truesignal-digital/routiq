// @vitest-environment jsdom
import { expect, it } from "vitest";
import { router } from "../router.js";

it("every screen in the shell names the skeleton it shows while it loads (#498)", () => {
  const missing = Object.values(router.routesById)
    // A route without a component only redirects (/more, /finance/approvals).
    .filter((route) => route.id.startsWith("/app/") && route.options.component !== undefined)
    .filter((route) => route.options.pendingComponent === undefined)
    .map((route) => route.id)
    .sort();
  expect(missing).toEqual([]);
});
