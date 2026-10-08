import { configure } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

/**
 * `findBy*` and `waitFor` give up after testing-library's 1 s default, and a
 * first render through the router plus its reads takes longer than that on a
 * loaded CI runner (#120, #132). Raising `testTimeout` (#67) never reached
 * them. Kept under vitest's 15 s `testTimeout` so a miss still reports the
 * query that failed. Pass no per-call `timeout` to work around slowness.
 */
configure({ asyncUtilTimeout: 10_000 });

/**
 * jsdom ships no `matchMedia`, and the responsive components lean on it —
 * `useIsMobile` calls it on mount, the DataTable picks table-vs-list-rows with it.
 * The stub answers `min-width`/`max-width` queries against jsdom's own window
 * (1024px), so every component reaches the same verdict: desktop. Tests that
 * want the phone layout keep overriding `window.matchMedia` themselves.
 */
function evaluateQuery(query: string): boolean {
  const min = /min-width:\s*(\d+)px/.exec(query);
  const max = /max-width:\s*(\d+)px/.exec(query);
  if (min !== null && window.innerWidth < Number(min[1])) return false;
  if (max !== null && window.innerWidth > Number(max[1])) return false;
  return min !== null || max !== null;
}

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      media: query,
      matches: evaluateQuery(query),
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

/**
 * Base UI reports misuse (a link inside a button-only part, #136) through
 * `console.error` in development only, so the running app was the only place
 * it showed. Failing the test that logs it keeps a new one out.
 */
const baseUiErrors: string[] = [];
const consoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const [first] = args;
  if (typeof first === "string" && first.startsWith("Base UI:")) baseUiErrors.push(first);
  consoleError(...args);
};

beforeEach(() => {
  baseUiErrors.length = 0;
});

afterEach(() => {
  if (baseUiErrors.length === 0) return;
  const logged = baseUiErrors.splice(0);
  throw new Error(`Base UI logged ${logged.length} error(s):\n\n${logged.join("\n\n")}`);
});
