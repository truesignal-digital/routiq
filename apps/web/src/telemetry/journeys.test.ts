import { describe, expect, it, vi } from "vitest";
import { trackRoutes, type JourneyReport, type RouterEvents } from "./journeys.js";

type Listener = (event: { pathChanged: boolean; toLocation: { pathname: string } }) => void;

function fakeRouter() {
  const listeners = new Map<string, Listener>();
  const router = {
    subscribe: (type: string, listener: Listener) => {
      listeners.set(type, listener);
      return () => listeners.delete(type);
    },
  } as unknown as RouterEvents;
  const emit = (type: "onBeforeNavigate" | "onRendered", pathname: string) =>
    listeners.get(type)?.({ pathChanged: true, toLocation: { pathname } });
  return { router, emit };
}

describe("trackRoutes", () => {
  it("reports app:usable first, then each route once its queries settle", async () => {
    const { router, emit } = fakeRouter();
    let fetching = 1;
    const reports: JourneyReport[] = [];
    const stop = trackRoutes(router, { isFetching: () => fetching }, (journey) => reports.push(journey));

    emit("onBeforeNavigate", "/");
    emit("onRendered", "/");
    fetching = 0;
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toMatchObject({ name: "app:usable", outcome: "ok" });

    emit("onBeforeNavigate", "/activities/0f3c2a1e-1b2c-4d5e-8f90-123456789abc");
    emit("onRendered", "/activities/0f3c2a1e-1b2c-4d5e-8f90-123456789abc");
    await vi.waitFor(() => expect(reports).toHaveLength(2));
    expect(reports[1]).toMatchObject({ name: "route:/activities/:id", outcome: "ok" });
    stop();
  });
});
