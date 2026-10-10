import { useCallback, useState } from "react";
import type { OverviewNotice } from "@routiq/contracts";

/**
 * What a person closed: the scheduled day's summary, and the big changes it
 * showed. Kept on the device, per person, workspace and Overview (#667);
 * there is no per-person preference store on the server yet.
 */
export interface ClosedSummary {
  /** Null when it was closed while the company's schedule was NEVER. */
  scheduledOn: string | null;
  changeKeys: string[];
}

export const SUMMARY_STORAGE_PREFIX = "routiq-summary-closed";

export function summaryStorageKey(workspaceId: string, principalId: string, page: string): string {
  return `${SUMMARY_STORAGE_PREFIX}:${workspaceId}:${principalId}:${page}`;
}

function isClosedSummary(value: unknown): value is ClosedSummary {
  if (typeof value !== "object" || value === null) return false;
  const closed = value as Record<string, unknown>;
  return (
    (typeof closed["scheduledOn"] === "string" || closed["scheduledOn"] === null) &&
    Array.isArray(closed["changeKeys"]) &&
    closed["changeKeys"].every((key) => typeof key === "string")
  );
}

export function readClosedSummary(key: string): ClosedSummary | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return undefined;
    const value: unknown = JSON.parse(raw);
    return isClosedSummary(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeClosedSummary(key: string, closed: ClosedSummary): void {
  try {
    localStorage.setItem(key, JSON.stringify(closed));
  } catch {
    // Storage full or blocked: the notice closes for this visit only.
  }
}

/** Why the notice is on screen; null when it is not due. */
export type NoticeReason = "MONDAY" | "MONTH_START" | "CHANGE";

/**
 * Due on a scheduled day the person has not closed, or when a big change
 * shows that their last close did not cover. Closing covers today's
 * scheduled summary and the changes on screen; the next scheduled day, or a
 * new change, brings it back. The company's schedule decides the scheduled
 * days (#669); under NEVER nothing is due, big changes included.
 */
export function noticeReason(notice: OverviewNotice, closed: ClosedSummary | undefined): NoticeReason | null {
  if (notice.schedule === "NEVER") return null;
  if (notice.scheduledToday !== null && closed?.scheduledOn !== notice.scheduledOn) return notice.scheduledToday;
  if (notice.changes.some((change) => !(closed?.changeKeys.includes(change.key) ?? false))) return "CHANGE";
  return null;
}

export interface SummaryNoticeState {
  /** Whether the summary is on screen. */
  open: boolean;
  /** Why it is due; null when it is on screen only because the person asked. */
  reason: NoticeReason | null;
  close: () => void;
  /** "Show summary": back on screen for this visit, without undoing the close. */
  show: () => void;
}

/**
 * The notice's state for one Overview. `storageKey` is undefined until the
 * person is known; the notice then stays closed, so it never flashes open for
 * someone who closed it.
 */
export function useSummaryNotice(notice: OverviewNotice | undefined, storageKey: string | undefined): SummaryNoticeState {
  const [closed, setClosed] = useState<{ key: string | undefined; value: ClosedSummary | undefined }>(() => ({
    key: storageKey,
    value: storageKey === undefined ? undefined : readClosedSummary(storageKey),
  }));
  const [shown, setShown] = useState(false);
  // The person or page changed under the same component: read their own close.
  const stored =
    closed.key === storageKey ? closed.value : storageKey === undefined ? undefined : readClosedSummary(storageKey);
  if (closed.key !== storageKey) setClosed({ key: storageKey, value: stored });

  const reason = notice === undefined || storageKey === undefined ? null : noticeReason(notice, stored);

  const close = useCallback(() => {
    setShown(false);
    if (notice === undefined || storageKey === undefined) return;
    const value = { scheduledOn: notice.scheduledOn, changeKeys: notice.changes.map((change) => change.key) };
    writeClosedSummary(storageKey, value);
    setClosed({ key: storageKey, value });
  }, [notice, storageKey]);
  const show = useCallback(() => setShown(true), []);

  return { open: notice !== undefined && (shown || reason !== null), reason, close, show };
}
