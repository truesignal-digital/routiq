import { useSyncExternalStore } from "react";

/**
 * Anything that takes over the phone screen: a form panel, a dialog, or the
 * sidebar opened as a sheet. Base UI unmounts a closed popup, so its presence
 * in the document is the open state, whichever screen opened it.
 */
const OVERLAY = [
  '[data-slot="sheet-content"]',
  '[data-slot="dialog-content"]',
  '[data-slot="alert-dialog-content"]',
  '[data-slot="sidebar"][data-mobile="true"]',
].join(", ");

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

function overlayOpen(): boolean {
  return document.querySelector(OVERLAY) !== null;
}

/** Whether a panel, dialog or the sidebar sheet is open; the phone's fixed bars step aside. */
export function usePanelOpen(): boolean {
  return useSyncExternalStore(subscribe, overlayOpen, () => false);
}
