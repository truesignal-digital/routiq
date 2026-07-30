// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THEME_STORAGE_KEY,
  getResolvedTheme,
  getThemeMode,
  initTheme,
  isThemeMode,
  resolveTheme,
  setThemeMode,
  subscribeTheme,
} from "./theme.js";

type ChangeListener = () => void;

/** jsdom evaluates no media queries, so the OS preference is driven explicitly. */
function stubSystemPreference(prefersDark: boolean) {
  const listeners = new Set<ChangeListener>();
  let matches = prefersDark;
  const query = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_event: string, listener: ChangeListener) => {
      listeners.add(listener);
    },
    removeEventListener: (_event: string, listener: ChangeListener) => {
      listeners.delete(listener);
    },
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => query),
  });
  return {
    change(next: boolean) {
      matches = next;
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

function root() {
  return document.documentElement;
}

beforeEach(() => {
  localStorage.clear();
  root().classList.remove("dark");
  root().style.colorScheme = "";
  stubSystemPreference(false);
});

afterEach(() => {
  // Leave no media listener behind for the next file.
  localStorage.clear();
  initTheme();
});

describe("theme mode", () => {
  it("defaults to following the system when nothing is stored", () => {
    initTheme();
    expect(getThemeMode()).toBe("system");
  });

  it("ignores a stored value that is not a mode", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "midnight");
    initTheme();
    expect(getThemeMode()).toBe("system");
  });

  it("recognises exactly the three modes", () => {
    expect(["light", "dark", "system"].every(isThemeMode)).toBe(true);
    expect(isThemeMode("midnight")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
  });
});

describe("applying the theme to the document", () => {
  it("applies the stored dark theme at startup", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    initTheme();

    expect(root().classList.contains("dark")).toBe(true);
    expect(root().style.colorScheme).toBe("dark");
  });

  it("drops the class and the colour scheme going back to light", () => {
    setThemeMode("dark");
    setThemeMode("light");

    expect(root().classList.contains("dark")).toBe(false);
    expect(root().style.colorScheme).toBe("light");
  });

  it("persists the chosen mode", () => {
    setThemeMode("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    setThemeMode("system");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("recolours the browser chrome so the PWA address bar follows", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", "#ffffff");
    document.head.append(meta);

    setThemeMode("dark");
    expect(meta.getAttribute("content")).toBe("#0a0a0a");

    setThemeMode("light");
    expect(meta.getAttribute("content")).toBe("#ffffff");

    meta.remove();
  });

  it("survives a browser that refuses storage", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });

    expect(() => initTheme()).not.toThrow();
    expect(() => setThemeMode("dark")).not.toThrow();
    expect(root().classList.contains("dark")).toBe(true);

    setItem.mockRestore();
    getItem.mockRestore();
  });
});

describe("system mode", () => {
  it("resolves against the OS preference", () => {
    stubSystemPreference(true);
    initTheme();

    expect(getResolvedTheme()).toBe("dark");
    expect(root().classList.contains("dark")).toBe(true);
  });

  it("follows the OS preference when it changes", () => {
    const system = stubSystemPreference(false);
    initTheme();
    expect(root().classList.contains("dark")).toBe(false);

    system.change(true);
    expect(root().classList.contains("dark")).toBe(true);

    system.change(false);
    expect(root().classList.contains("dark")).toBe(false);
  });

  it("ignores the OS preference once a mode is pinned", () => {
    const system = stubSystemPreference(false);
    initTheme();
    setThemeMode("dark");

    system.change(false);
    expect(root().classList.contains("dark")).toBe(true);

    setThemeMode("light");
    system.change(true);
    expect(root().classList.contains("dark")).toBe(false);
  });

  it("replaces its media listener instead of stacking one per call", () => {
    const system = stubSystemPreference(false);
    initTheme();
    initTheme();
    initTheme();

    expect(system.listenerCount()).toBe(1);
  });

  it("resolves a pinned mode without asking the OS", () => {
    stubSystemPreference(true);
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("system")).toBe("dark");
  });
});

describe("subscribers", () => {
  it("notifies on a mode change and stops after unsubscribing", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTheme(listener);

    setThemeMode("dark");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setThemeMode("light");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies when the OS preference moves under system mode", () => {
    const system = stubSystemPreference(false);
    initTheme();
    const listener = vi.fn();
    const unsubscribe = subscribeTheme(listener);

    system.change(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
