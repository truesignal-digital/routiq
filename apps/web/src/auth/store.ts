import { useSyncExternalStore } from "react";
import { SessionStore, type StoredSession } from "./session.js";

export const sessionStore = new SessionStore(localStorage);

export function useActiveSession(): StoredSession | undefined {
  return useSyncExternalStore(
    (onChange) => sessionStore.subscribe(onChange),
    () => sessionStore.getActive(),
  );
}
