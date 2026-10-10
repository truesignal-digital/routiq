import { workspaceMonth, workspaceToday } from "../lib/workspace-day.js";
import { useMeContext } from "./me.js";

/** The zone a workspace gets when none is set (`workspaces.timezone`'s default). */
const DEFAULT_TIMEZONE = "Africa/Douala";

/** Today in the signed-in workspace's calendar, as an ISO date (#639). */
export function useWorkspaceToday(): string {
  return workspaceToday(useMeContext()?.timezone ?? DEFAULT_TIMEZONE);
}

/** This month in the signed-in workspace's calendar, `YYYY-MM` (#639). */
export function useWorkspaceMonth(): string {
  return workspaceMonth(useMeContext()?.timezone ?? DEFAULT_TIMEZONE);
}
