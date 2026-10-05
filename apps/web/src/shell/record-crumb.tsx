import { useRouterState } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface RecordCrumb {
  pathname: string;
  label: string;
}

interface RecordCrumbStore {
  current: RecordCrumb | undefined;
  set: (crumb: RecordCrumb | undefined) => void;
}

const RecordCrumbCtx = createContext<RecordCrumbStore | undefined>(undefined);

/** Lets a detail screen name its record in the shell's breadcrumb. */
export function RecordCrumbProvider({ children }: { children: ReactNode }) {
  const [current, set] = useState<RecordCrumb | undefined>(undefined);
  return <RecordCrumbCtx.Provider value={{ current, set }}>{children}</RecordCrumbCtx.Provider>;
}

/**
 * The record name a screen published for `pathname`. Keyed by path so the
 * frame between leaving one record and its screen unmounting never shows the
 * old name on the next page.
 */
export function useRecordCrumbLabel(pathname: string): string | undefined {
  const current = useContext(RecordCrumbCtx)?.current;
  return current?.pathname === pathname ? current.label : undefined;
}

/** Names the record this screen shows in the breadcrumb, for as long as it is mounted. */
export function useRecordCrumb(label: string | undefined): void {
  const set = useContext(RecordCrumbCtx)?.set;
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (set === undefined || label === undefined) return;
    set({ pathname, label });
    return () => set(undefined);
  }, [set, pathname, label]);
}
