import { useSyncExternalStore } from "react";
import {
  getResolvedTheme,
  getThemeMode,
  setThemeMode,
  subscribeTheme,
  type ResolvedTheme,
  type ThemeMode,
} from "@/lib/theme";

export interface UseTheme {
  /** What the user picked, including "system". */
  mode: ThemeMode;
  /** What the document is actually showing. */
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

export function useTheme(): UseTheme {
  const mode = useSyncExternalStore(subscribeTheme, getThemeMode);
  const resolvedTheme = useSyncExternalStore(subscribeTheme, getResolvedTheme);
  return { mode, resolvedTheme, setMode: setThemeMode };
}
