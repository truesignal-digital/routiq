import { createElement, use, type ComponentType, type ReactElement } from "react";

/**
 * A screen whose code is fetched on demand (#480, #488). Replaces TanStack's
 * `lazyRouteComponent`, which kept a failed import forever and reloaded the
 * page on the next render: offline, that reload left the browser's error page
 * in place of the app.
 *
 * The browser keeps a failed module file failed for the life of the page (the
 * module map caches the failure; a second `import()` of the same URL never
 * reaches the network). So:
 * - Offline (`navigator.onLine` false) nothing is fetched at all, so nothing is
 *   spoiled. A screen opened offline shows its error at once and opens when the
 *   connection returns.
 * - A screen file that failed is fetched again under a new URL
 *   (`…/X.js?retry=…`), which the browser treats as a new module.
 * - `preload()` (the background fetch, and the router's fetch before a
 *   navigation) never rejects; a failure only records the URL to retry.
 * - Rendering without the code suspends on a fetch. If it fails, the render
 *   throws a `ScreenLoadError` to the route's error boundary, which keeps the
 *   shell and offers Try again. The error stays until `retryFailedScreens()`
 *   (Try again, the next navigation, the connection coming back), so React's
 *   own re-render after an error does not loop on fetches.
 * - The only automatic reload: online, and the server's index.html names a
 *   different entry file (a deploy replaced the files). Once per new entry.
 * - When the screen's file under a new URL fails too while the server hands
 *   that file out, a file it imports is the one left failed, and a new URL
 *   cannot help (the import inside still names it). The error then says so
 *   (`needsReload`) and Try again reloads the page.
 */
export class ScreenLoadError extends Error {
  readonly needsReload: boolean;
  constructor(cause: unknown, needsReload = false) {
    super("A screen's code could not be loaded", { cause });
    this.name = "ScreenLoadError";
    this.needsReload = needsReload;
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

/** Whether the server answers, and the entry script its index.html names when that differs from this page's. */
async function probeServer(): Promise<{ reachable: boolean; newerEntry?: string }> {
  const entry = (doc: Document) => doc.querySelector('script[type="module"][src]')?.getAttribute("src") ?? undefined;
  try {
    const response = await fetch("/", { cache: "no-store" });
    if (!response.ok) return { reachable: false };
    const current = entry(document);
    const deployed = entry(new DOMParser().parseFromString(await response.text(), "text/html"));
    return current !== undefined && deployed !== undefined && deployed !== current ? { reachable: true, newerEntry: deployed } : { reachable: true };
  } catch {
    return { reachable: false };
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

/** Whether the server hands out this file now; if not, a new page would fail on it too. */
async function serves(file: string): Promise<boolean> {
  try {
    return (await fetch(file, { method: "HEAD", cache: "no-store" })).ok;
  } catch {
    return false;
  }
}

/** The file a failed `import()` names (Chrome and Firefox put it in the message). */
const failedFile = (error: unknown) => (error instanceof Error ? /\bhttps?:\/\/\S+?\.[cm]?[jt]sx?\b/.exec(error.message)?.[0] : undefined);

const offline = () => typeof navigator !== "undefined" && !navigator.onLine;

export function lazyScreen<M extends Record<K, ComponentType>, K extends keyof M & string>(
  importer: () => Promise<M>,
  exportName: K,
  /** Imports the screen's file under a new URL; tests replace it. */
  importAnew: (url: string) => Promise<M> = (url) => import(/* @vite-ignore */ url) as Promise<M>,
): LazyScreen {
  let screen: ComponentType | undefined;
  let fetching: Promise<void> | undefined;
  let renderFetch: Promise<void> | undefined;
  let error: ScreenLoadError | undefined;
  /** The screen's own file, once an import of it has failed. */
  let spoiled: string | undefined;
  /** A fetch under a new URL failed too: something the screen imports is spoiled. */
  let retriedAndFailed = false;

  const fetchCode = (): Promise<void> => {
    if (screen !== undefined) return Promise.resolve();
    if (fetching !== undefined) return fetching;
    if (offline()) return Promise.reject(new TypeError("offline"));
    const retrying = spoiled !== undefined;
    const attempt = spoiled !== undefined ? importAnew(`${spoiled}?retry=${Date.now()}`) : importer();
    fetching = attempt
      .then((module) => {
        screen = module[exportName];
      })
      .catch((cause: unknown) => {
        spoiled ??= failedFile(cause);
        if (retrying || spoiled === undefined) retriedAndFailed = true;
        throw cause;
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
        let needsReload = false;
        if (!offline()) {
          const server = await probeServer();
          // Stay suspended while the page reloads.
          if (server.newerEntry !== undefined && reloadOnceFor(server.newerEntry)) return new Promise<void>(() => undefined);
          needsReload = server.reachable && retriedAndFailed && (spoiled === undefined || (await serves(spoiled)));
        }
        error = new ScreenLoadError(cause, needsReload);
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
