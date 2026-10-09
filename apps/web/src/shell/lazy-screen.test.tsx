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
    const { error } = this.state;
    if (error !== undefined) {
      return (
        <div>
          <p>{error instanceof ScreenLoadError ? `load failed${error.needsReload ? ", reload" : ""}` : "other error"}</p>
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
type Module = { Page: typeof Page };
const importFailure = () => new TypeError("Failed to fetch dynamically imported module");
let onLine = true;

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

const serverIndex = (entry: string) => new Response(`<html><head><script type="module" crossorigin src="${entry}"></script></head></html>`);

describe("lazyScreen", () => {
  let entry: HTMLScriptElement;
  beforeEach(() => {
    onLine = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => onLine);
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
    const importer = vi.fn<() => Promise<Module>>().mockRejectedValueOnce(importFailure()).mockResolvedValue({ Page });
    const Lazy = lazyScreen(importer, "Page");
    await expect(Lazy.preload()).resolves.toBeUndefined();
    await Lazy.preload();
    expect(importer).toHaveBeenCalledTimes(2);
    await mount(Lazy);
    expect(screen.getByRole("heading", { name: "Branches" })).toBeTruthy();
  });

  it("offline, fetches nothing, shows the error in place and opens on retry once back online", async () => {
    onLine = false;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const importer = vi.fn<() => Promise<Module>>().mockResolvedValue({ Page });
    const Lazy = lazyScreen(importer, "Page");
    await Lazy.preload();
    await mount(Lazy);
    expect(screen.getByText("load failed")).toBeTruthy();
    // Nothing fetched offline, so nothing is left failed for when the connection returns.
    expect(importer).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    onLine = true;
    expect(retryFailedScreens()).toBe(true);
    await act(async () => screen.getByRole("button", { name: "retry" }).click());
    expect(screen.getByRole("heading", { name: "Branches" })).toBeTruthy();
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("keeps the error until a retry, so React's re-render does not fetch again", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(serverIndex("/static/index-a.js"));
    const importer = vi.fn<() => Promise<Module>>().mockRejectedValue(importFailure());
    const Lazy = lazyScreen(importer, "Page");
    await mount(Lazy);
    expect(screen.getByText(/^load failed/)).toBeTruthy();
    const calls = importer.mock.calls.length;
    await act(async () => screen.getByRole("button", { name: "retry" }).click());
    expect(screen.getByText(/^load failed/)).toBeTruthy();
    expect(importer.mock.calls.length).toBe(calls);
  });

  it("online with the same deployed entry, does not reload; with no file to fetch anew, Try again must reload", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(serverIndex("/static/index-a.js"));
    const Lazy = lazyScreen(vi.fn<() => Promise<Module>>().mockRejectedValue(importFailure()), "Page");
    await mount(Lazy);
    expect(fetchSpy).toHaveBeenCalledWith("/", { cache: "no-store" });
    expect(sessionStorage.length).toBe(0);
    // The message names no file, so this page cannot fetch it anew; the server answered.
    expect(screen.getByText("load failed, reload")).toBeTruthy();
  });

  it.each([
    [404, "load failed"],
    [200, "load failed, reload"],
  ])("asks for a reload only when the server hands out the file it failed on (HEAD %i)", async (status, shown) => {
    const file = "http://127.0.0.1:1/static/BranchesScreen-x.js";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      input === "/" ? serverIndex("/static/index-a.js") : new Response(null, { status }),
    );
    const failure = new TypeError(`Failed to fetch dynamically imported module: ${file}`);
    const importAnew = vi.fn<(url: string) => Promise<Module>>().mockRejectedValue(failure);
    const Lazy = lazyScreen(vi.fn<() => Promise<Module>>().mockRejectedValue(failure), "Page", importAnew);
    await Lazy.preload();
    // The tap fetches the file under a new URL; that fails too.
    await mount(Lazy);
    expect(importAnew).toHaveBeenCalledWith(expect.stringMatching(/BranchesScreen-x\.js\?retry=\d+$/));
    expect(fetchSpy).toHaveBeenCalledWith(file, { method: "HEAD", cache: "no-store" });
    expect(screen.getByText(shown)).toBeTruthy();
  });

  it("when the server does not answer, does not ask for a reload", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const Lazy = lazyScreen(vi.fn<() => Promise<Module>>().mockRejectedValue(importFailure()), "Page");
    await mount(Lazy);
    expect(screen.getByText("load failed")).toBeTruthy();
  });

  it("after a deploy it has already reloaded for, shows the error rather than reloading again", async () => {
    sessionStorage.setItem("routiq-reloaded-for-entry", "/static/index-b.js");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(serverIndex("/static/index-b.js"));
    const Lazy = lazyScreen(vi.fn<() => Promise<Module>>().mockRejectedValue(importFailure()), "Page");
    await mount(Lazy);
    expect(screen.getByText(/^load failed/)).toBeTruthy();
    expect(sessionStorage.getItem("routiq-reloaded-for-entry")).toBe("/static/index-b.js");
  });
});
