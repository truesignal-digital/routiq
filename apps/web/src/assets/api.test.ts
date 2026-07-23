import { describe, expect, it } from "vitest";
import { readActiveSessionToken } from "./api.js";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("asset API session compatibility", () => {
  it("reads the active token from the username-keyed session shape", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "asset.sessions.v1",
      JSON.stringify({
        activeUsername: "fatima",
        sessions: { fatima: { token: "session-token" } },
      }),
    );

    expect(readActiveSessionToken(storage)).toBe("session-token");
  });

  it("treats malformed or absent state as signed out", () => {
    const storage = new MemoryStorage();
    expect(readActiveSessionToken(storage)).toBeNull();
    storage.setItem("asset.sessions.v1", "{not-json");
    expect(readActiveSessionToken(storage)).toBeNull();
  });
});
