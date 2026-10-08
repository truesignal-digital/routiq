import { useSyncExternalStore } from "react";

/**
 * A stand-in for the router's search params in screen tests that render
 * without a router: `useSearch` reads it, and a mocked `navigate` writes it
 * through `applyNavigate`, so a screen whose filters live in the URL still
 * re-renders on a click. Reset it between tests.
 */
type Search = Record<string, unknown>;

let current: Search = {};
const listeners = new Set<() => void>();

function publish(next: Search): void {
  current = Object.fromEntries(
    Object.entries(next).filter(([, value]) => value !== undefined),
  );
  for (const listener of listeners) listener();
}

export function resetSearch(next: Search = {}): void {
  publish(next);
}

export function currentSearch(): Search {
  return current;
}

export function useTestSearch(): Search {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

export function applyNavigate(options: unknown): void {
  if (typeof options !== "object" || options === null || !("search" in options)) return;
  const search = (options as { search: unknown }).search;
  if (typeof search === "function") publish((search as (prev: Search) => Search)(current));
  else if (typeof search === "object" && search !== null) publish(search as Search);
}
