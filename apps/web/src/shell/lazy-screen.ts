import { createElement, use, type ComponentType, type ReactElement } from "react";

/**
 * A screen whose code is fetched on demand (#480, #488). Unlike TanStack's
 * `lazyRouteComponent`, a failed fetch is never cached and never reloads the
 * page on its own: the field connection drops often, and a reload while
 * offline leaves the browser's error page in place of the app.
 *
 * - `preload()` is the background fetch and the router's own fetch before a
 *   navigation. It never rejects; a failure just leaves the next attempt free.
 * - Rendering without the code suspends on a fresh fetch. If that fails, the
 *   render throws a `ScreenLoadError` to the route's error boundary, which
 *   keeps the shell and offers Retry. The error stays until
 *   `retryFailedScreens()` (Retry, the next navigation, the connection coming
 *   back), so React's own re-render after an error does not loop on fetches.
 * - The one reload: online, and the server's index.html names a different
 *   entry file, so a deploy removed this file. Once per new entry.
 */
export class ScreenLoadError extends Error {
  constructor(cause: unknown) {
    super("A screen's code could not be loaded", { cause });
    this.name = "ScreenLoadError";
  }
}

export type LazyScreen = ((props: object) => ReactElement) & { preload: () => Promise<void> };

const failed = new Set<() => void>();

/** Clears every remembered load failure so the next render fetches again; true if there was one. */
export function retryFailedScreens(): boolean {
  const any = failed.size > 0;
  for (const clear of failed) clear();
  failed.clear();
  return any;
}

const RELOADED_FOR = "routiq-reloaded-for-entry";

/** The entry script the server's index.html names now, when it differs from the one this page runs. */
async function newerDeployedEntry(): Promise<string | undefined> {
  const entry = (doc: Document) => doc.querySelector('script[type="module"][src]')?.getAttribute("src") ?? undefined;
  const current = entry(document);
  if (current === undefined) return undefined;
  try {
    const response = await fetch("/", { cache: "no-store" });
    if (!response.ok) return undefined;
    const deployed = entry(new DOMParser().parseFromString(await response.text(), "text/html"));
    return deployed !== undefined && deployed !== current ? deployed : undefined;
  } catch {
    return undefined;
  }
}

/** Reloads once for this deployed entry; false when it already did, or storage is unavailable. */
function reloadOnceFor(entry: string): boolean {
  try {
    if (sessionStorage.getItem(RELOADED_FOR) === entry) return false;
    sessionStorage.setItem(RELOADED_FOR, entry);
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

export function lazyScreen<M extends Record<K, ComponentType>, K extends keyof M & string>(
  importer: () => Promise<M>,
  exportName: K,
): LazyScreen {
  let screen: ComponentType | undefined;
  let fetching: Promise<void> | undefined;
  let renderFetch: Promise<void> | undefined;
  let error: ScreenLoadError | undefined;

  const fetchCode = (): Promise<void> => {
    if (screen !== undefined) return Promise.resolve();
    fetching ??= importer()
      .then((module) => {
        screen = module[exportName];
      })
      .finally(() => {
        fetching = undefined;
      });
    return fetching;
  };

  const preload = () => fetchCode().catch(() => undefined);

  const fetchForRender = (): Promise<void> => {
    renderFetch ??= fetchCode()
      .catch(async (cause: unknown) => {
        if (navigator.onLine) {
          const deployed = await newerDeployedEntry();
          // Stay suspended while the page reloads.
          if (deployed !== undefined && reloadOnceFor(deployed)) return new Promise<void>(() => undefined);
        }
        error = new ScreenLoadError(cause);
        failed.add(() => {
          error = undefined;
        });
      })
      .finally(() => {
        renderFetch = undefined;
      });
    return renderFetch;
  };

  function Lazy(props: object): ReactElement {
    if (screen !== undefined) return createElement(screen, props);
    if (error !== undefined) throw error;
    use(fetchForRender());
    // The fetch settled during this render: show the screen, or the error.
    if (screen !== undefined) return createElement(screen, props);
    throw error ?? new ScreenLoadError(undefined);
  }
  Lazy.preload = preload;
  return Lazy;
}
