import { routeTemplate, type JOURNEY_OUTCOMES } from "@routiq/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { AnyRouter } from "@tanstack/react-router";
import { nextFrame, toMs } from "./collect.js";

export type JourneyOutcome = (typeof JOURNEY_OUTCOMES)[number];
export type QueryActivity = Pick<QueryClient, "isFetching">;
export type RouterEvents = Pick<AnyRouter, "subscribe">;

export interface JourneyReport {
  name: string;
  durationMs: number;
  outcome: JourneyOutcome;
  serverMs?: number;
}

const SETTLE_TIMEOUT_MS = 30_000;

/** Keeps a journey name inside the contract's `<kind>:<what>` pattern. */
export function journeyName(kind: string, what: string): string {
  return `${kind}:${what.replace(/[^\w\-/:.$]/g, "_") || "_"}`.slice(0, 120);
}

/**
 * Resolves true once no query has been fetching for two consecutive frames,
 * or false after the timeout.
 */
export function whenQueriesSettle(
  queries: QueryActivity,
  timeoutMs = SETTLE_TIMEOUT_MS,
): { settled: Promise<boolean>; cancel: () => void } {
  let cancelFrame = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finish: (ok: boolean) => void = () => {};
  const settled = new Promise<boolean>((resolve) => {
    let done = false;
    let calmFrames = 0;
    finish = (ok) => {
      if (done) return;
      done = true;
      cancelFrame();
      clearTimeout(timer);
      resolve(ok);
    };
    const tick = () => {
      calmFrames = queries.isFetching() === 0 ? calmFrames + 1 : 0;
      if (calmFrames >= 2) finish(true);
      else cancelFrame = nextFrame(tick);
    };
    timer = setTimeout(() => finish(false), timeoutMs);
    cancelFrame = nextFrame(tick);
  });
  return {
    settled,
    cancel: () => {
      cancelFrame();
      clearTimeout(timer);
    },
  };
}

/**
 * `app:usable` for the first rendered route (from the page's time origin),
 * then `route:<template>` for each path change, from navigation start until
 * the route has rendered and its queries have settled. A redirect before the
 * render keeps the original start (unless that start is stale: a navigation
 * that never rendered); a new navigation after the render abandons the wait.
 */
export function trackRoutes(
  router: RouterEvents,
  queries: QueryActivity,
  report: (journey: JourneyReport) => void,
): () => void {
  let usableReported = false;
  let pendingStart: number | undefined;
  let waiting: (() => void) | undefined;

  const unsubscribeNavigate = router.subscribe("onBeforeNavigate", (event) => {
    if (!event.pathChanged) return;
    if (pendingStart !== undefined && performance.now() - pendingStart < SETTLE_TIMEOUT_MS) return;
    waiting?.();
    waiting = undefined;
    pendingStart = performance.now();
  });

  const unsubscribeRendered = router.subscribe("onRendered", (event) => {
    let name: string;
    let start: number;
    if (!usableReported) {
      usableReported = true;
      name = "app:usable";
      start = 0;
    } else if (pendingStart !== undefined) {
      name = journeyName("route", routeTemplate(event.toLocation.pathname));
      start = pendingStart;
    } else {
      return;
    }
    pendingStart = undefined;
    waiting?.();
    const wait = whenQueriesSettle(queries);
    let abandoned = false;
    waiting = () => {
      abandoned = true;
      wait.cancel();
    };
    void wait.settled.then((ok) => {
      if (abandoned) return;
      waiting = undefined;
      // A hidden tab stops frames; its timeout says nothing about the app.
      if (!ok && document.visibilityState === "hidden") return;
      const outcome: JourneyOutcome = ok ? "ok" : navigator.onLine === false ? "offline" : "error";
      report({ name, durationMs: toMs(performance.now() - start), outcome });
    });
  });

  return () => {
    waiting?.();
    unsubscribeNavigate();
    unsubscribeRendered();
  };
}
