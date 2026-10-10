import type { QueryClient } from "@tanstack/react-query";
import { meQueryOptions, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { visibleSections } from "./sections.js";

interface Preloader {
  preloadRoute: (options: { to: string }) => Promise<unknown>;
}

/** Past this, a screen still fetching is not waited on any longer. */
const QUIET_WAIT_MS = 10_000;

/**
 * After Home has settled, loads the code and first-view data of each sidebar
 * row this member can see, one at a time and only while nothing else is
 * fetching (#497). A row the role or modules hide is never fetched. The Query
 * cache keeps what this loads; a tap on the row then opens it at once.
 */
export async function preloadSidebarScreens(
  router: Preloader,
  queryClient: QueryClient,
  busy: () => boolean = () => queryClient.isFetching() > 0,
): Promise<void> {
  const session = sessionStore.getActive();
  const me: MeContext | undefined = queryClient.getQueryData(meQueryOptions(queryClient, session).queryKey);
  if (me === undefined) return;
  for (const section of visibleSections(me.role, me.enabledModules)) {
    if (section.to === "/") continue;
    await whenQuiet(busy);
    // A preload that fails is dropped: the real visit tries again and shows its own error.
    await router.preloadRoute({ to: section.to }).catch(() => undefined);
  }
}

async function whenQuiet(busy: () => boolean): Promise<void> {
  const until = Date.now() + QUIET_WAIT_MS;
  while (busy() && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
