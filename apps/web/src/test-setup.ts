import { configure } from "@testing-library/react";

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
 * `useIsMobile` calls it on mount, the DataTable picks table-vs-cards with it.
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
