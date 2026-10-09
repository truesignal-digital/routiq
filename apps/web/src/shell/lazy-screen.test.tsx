import { Component, Suspense, type ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lazyScreen, retryFailedScreens, ScreenLoadError } from "./lazy-screen.js";

class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state = { error: undefined as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    if (this.state.error !== undefined) {
      return (
        <div>
          <p>{this.state.error instanceof ScreenLoadError ? "load failed" : "other error"}</p>
          <button type="button" onClick={() => this.setState({ error: undefined })}>
            retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const Page = () => <h1>Branches</h1>;
const offline = () => vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
const online = () => vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);

/** Renders inside act, so a fetch that settles suspends and resumes as it would in the browser. */
async function mount(Lazy: ReturnType<typeof lazyScreen>) {
  await act(async () => {
    render(
      <Boundary>
        <Suspense fallback={<p>loading</p>}>
          <Lazy />
        </Suspense>
      </Boundary>,
    );
  });
}

describe("lazyScreen", () => {
  let entry: HTMLScriptElement;
  beforeEach(() => {
    entry = document.createElement("script");
    entry.type = "module";
    entry.src = "/static/index-a.js";
    document.head.append(entry);
  });
  afterEach(() => {
    entry.remove();
    retryFailedScreens();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("does not remember a failed background fetch: the next one tries again", async () => {
    const importer = vi.fn<() => Promise<{ Page: typeof Page }>>().mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module")).mockResolvedValue({ Page });
    const Lazy = lazyScreen(importer, "Page");
    await expect(Lazy.preload()).resolves.toBeUndefined();
    await Lazy.preload();
    expect(importer).toHaveBeenCalledTimes(2);
    await mount(Lazy);
    expect(screen.getByRole("heading", { name: "Branches" })).toBeTruthy();
  });

  it("offline, shows the error in place, never reloads, and opens on retry once the code arrives", async () => {
    offline();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const importer = vi.fn<() => Promise<{ Page: typeof Page }>>().mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module")).mockResolvedValue({ Page });
    const Lazy = lazyScreen(importer, "Page");
    await mount(Lazy);
    expect(screen.getByText("load failed")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    // The error stays put until a retry: React's re-render does not fetch again.
    expect(importer).toHaveBeenCalledTimes(1);

    expect(retryFailedScreens()).toBe(true);
    await act(async () => screen.getByRole("button", { name: "retry" }).click());
    expect(screen.getByRole("heading", { name: "Branches" })).toBeTruthy();
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it("online with the same deployed entry, treats the failure as the connection's and does not reload", async () => {
    online();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response('<html><head><script type="module" crossorigin src="/static/index-a.js"></script></head></html>'));
    const Lazy = lazyScreen(vi.fn<() => Promise<{ Page: typeof Page }>>().mockRejectedValue(new TypeError("Failed to fetch dynamically imported module")), "Page");
    await mount(Lazy);
    expect(screen.getByText("load failed")).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledWith("/", { cache: "no-store" });
    expect(sessionStorage.length).toBe(0);
  });

  it("after a deploy it has already reloaded for, shows the error rather than reloading again", async () => {
    online();
    sessionStorage.setItem("routiq-reloaded-for-entry", "/static/index-b.js");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('<script type="module" src="/static/index-b.js"></script>'));
    const Lazy = lazyScreen(vi.fn<() => Promise<{ Page: typeof Page }>>().mockRejectedValue(new TypeError("Failed to fetch dynamically imported module")), "Page");
    await mount(Lazy);
    expect(screen.getByText("load failed")).toBeTruthy();
  });
});
