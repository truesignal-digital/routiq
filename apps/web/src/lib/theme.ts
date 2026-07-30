/**
 * Theme is a device preference, not workspace data: it lives in localStorage and
 * never travels through a command. The store is plain module state so the stored
 * theme can be applied before React mounts — a paint in the wrong theme is worse
 * than any of the state libraries would be worth.
 */
export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "routiq-theme";

export const themeModes: readonly ThemeMode[] = ["light", "dark", "system"];

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

/** Storage access throws in private-mode browsers, so every read is guarded. */
function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function writeStoredMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // A device that refuses storage still gets the theme for this session.
  }
}

function systemQuery(): MediaQueryList | undefined {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(SYSTEM_DARK_QUERY)
    : undefined;
}

let mode: ThemeMode | undefined;
const listeners = new Set<() => void>();
let detachSystemListener: (() => void) | undefined;

function currentMode(): ThemeMode {
  if (mode === undefined) mode = readStoredMode();
  return mode;
}

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/** Mirrors `--background` in styles.css; a meta tag cannot read a CSS variable. */
const BROWSER_CHROME_COLOR: Record<ResolvedTheme, string> = {
  light: "#ffffff",
  dark: "#0a0a0a",
};

function apply(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  // Without color-scheme the native controls and scrollbars stay light.
  root.style.colorScheme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", BROWSER_CHROME_COLOR[resolved]);
}

export function resolveTheme(themeMode: ThemeMode): ResolvedTheme {
  if (themeMode !== "system") return themeMode;
  return systemQuery()?.matches === true ? "dark" : "light";
}

export function getThemeMode(): ThemeMode {
  return currentMode();
}

export function getResolvedTheme(): ResolvedTheme {
  return resolveTheme(currentMode());
}

export function setThemeMode(next: ThemeMode): void {
  mode = next;
  writeStoredMode(next);
  apply(resolveTheme(next));
  emit();
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Applies the stored theme and starts following the OS preference. Call this
 * synchronously at startup, before the first render, and again to re-read
 * storage; it is idempotent and replaces its own media listener.
 */
export function initTheme(): void {
  detachSystemListener?.();
  detachSystemListener = undefined;

  mode = readStoredMode();
  apply(resolveTheme(mode));

  const query = systemQuery();
  if (query === undefined) return;

  const onChange = () => {
    if (currentMode() !== "system") return;
    apply(resolveTheme("system"));
    emit();
  };
  query.addEventListener("change", onChange);
  detachSystemListener = () => query.removeEventListener("change", onChange);
}
