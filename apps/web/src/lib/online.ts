import { useSyncExternalStore } from "react";

// The same events Query's onlineManager pauses and resumes reads on. Read
// here directly because some tests mock @tanstack/react-query whole.
function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** False while the device has no connection (#576). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
