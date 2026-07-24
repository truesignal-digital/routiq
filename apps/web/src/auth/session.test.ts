import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionStore } from "./session.js";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
}

const future = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
const past = new Date(Date.now() - 1000).toISOString();

describe("SessionStore", () => {
  let storage: Storage;
  let store: SessionStore;

  beforeEach(() => {
    storage = fakeStorage();
    store = new SessionStore(storage);
  });

  it("saves a session keyed by username and makes it active", () => {
    store.save({ username: "amina", workspaceSlug: "sotrafret", token: "t1", expiresAt: future });
    expect(store.getActive()?.username).toBe("amina");
    expect(store.getActive()?.token).toBe("t1");
  });

  it("sessions are stored per username — a second login does not evict the first", () => {
    store.save({ username: "amina", workspaceSlug: "sotrafret", token: "t1", expiresAt: future });
    store.save({ username: "bakary", workspaceSlug: "sotrafret", token: "t2", expiresAt: future });
    expect(store.getActive()?.username).toBe("bakary");
    store.logout({ username: "bakary", workspaceSlug: "sotrafret" });
    expect(store.getSession({ username: "amina", workspaceSlug: "sotrafret" })?.token).toBe("t1");
  });

  it("logout clears only that username's session", () => {
    store.save({ username: "amina", workspaceSlug: "sotrafret", token: "t1", expiresAt: future });
    store.save({ username: "bakary", workspaceSlug: "sotrafret", token: "t2", expiresAt: future });
    store.logout({ username: "bakary", workspaceSlug: "sotrafret" });
    expect(store.getSession({ username: "bakary", workspaceSlug: "sotrafret" })).toBeUndefined();
    expect(store.getSession({ username: "amina", workspaceSlug: "sotrafret" })).toBeDefined();
    expect(store.getActive()).toBeUndefined();
  });

  it("logout keeps the last identity for prefill — PIN required, username remembered", () => {
    store.save({ username: "amina", workspaceSlug: "sotrafret", token: "t1", expiresAt: future });
    store.logout({ username: "amina", workspaceSlug: "sotrafret" });
    expect(store.getActive()).toBeUndefined();
    expect(store.getLastIdentity()).toEqual({ username: "amina", workspaceSlug: "sotrafret" });
  });

  it("an expired session is not returned as active but its username is remembered for re-prompt", () => {
    store.save({ username: "amina", workspaceSlug: "sotrafret", token: "t1", expiresAt: past });
    expect(store.getActive()).toBeUndefined();
    expect(store.getLastIdentity()).toEqual({ username: "amina", workspaceSlug: "sotrafret" });
  });

  it("survives a restart — a new store over the same storage sees the session", () => {
    store.save({ username: "amina", workspaceSlug: "sotrafret", token: "t1", expiresAt: future });
    const rebooted = new SessionStore(storage);
    expect(rebooted.getActive()?.token).toBe("t1");
  });

  it("notifies subscribers on save and logout", () => {
    const listener = vi.fn();
    store.subscribe(listener);
    store.save({ username: "amina", workspaceSlug: "sotrafret", token: "t1", expiresAt: future });
    store.logout({ username: "amina", workspaceSlug: "sotrafret" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("getToken returns the active session token for the command client", () => {
    expect(store.getToken()).toBeUndefined();
    store.save({ username: "amina", workspaceSlug: "sotrafret", token: "t1", expiresAt: future });
    expect(store.getToken()).toBe("t1");
  });

  it("same username in two workspaces holds two independent sessions", () => {
    store.save({ username: "admin", workspaceSlug: "sotrafret", token: "t1", expiresAt: future });
    store.save({ username: "admin", workspaceSlug: "voyage-plus", token: "t2", expiresAt: future });
    expect(store.getSession({ username: "admin", workspaceSlug: "sotrafret" })?.token).toBe("t1");
    expect(store.getSession({ username: "admin", workspaceSlug: "voyage-plus" })?.token).toBe("t2");
  });

  it("tolerates corrupted storage content", () => {
    storage.setItem("routiq.sessions.v1", "{not json");
    const recovered = new SessionStore(storage);
    expect(recovered.getActive()).toBeUndefined();
  });
});
