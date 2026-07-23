import { describe, expect, it, vi } from "vitest";
import { CommandStatusStore } from "./store.js";

describe("CommandStatusStore", () => {
  it("tracks submitting → committed", () => {
    const store = new CommandStatusStore();
    store.markSubmitting("cmd-1");
    expect(store.get("cmd-1")).toEqual({ state: "submitting" });

    const outcome = {
      commandId: "cmd-1",
      recordId: "rec-1",
      rowVersion: 1,
      warnings: [],
      idempotentReplay: false,
    };
    store.markCommitted("cmd-1", outcome);
    expect(store.get("cmd-1")).toEqual({ state: "committed", outcome });
  });

  it("tracks submitting → rejected with a stable code", () => {
    const store = new CommandStatusStore();
    store.markSubmitting("cmd-1");
    store.markRejected("cmd-1", "VALIDATION_FAILED", { field: "code" });
    expect(store.get("cmd-1")).toEqual({
      state: "rejected",
      code: "VALIDATION_FAILED",
      metadata: { field: "code" },
    });
  });

  it("notifies subscribers on every transition and stops after unsubscribe", () => {
    const store = new CommandStatusStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.markSubmitting("cmd-1");
    store.markRejected("cmd-1", "COMMAND_FAILED");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.markSubmitting("cmd-2");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("snapshot is immutable-by-reference: unchanged without transitions, new after one", () => {
    const store = new CommandStatusStore();
    store.markSubmitting("cmd-1");
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    store.markCommitted("cmd-1", {
      commandId: "cmd-1",
      recordId: "rec-1",
      rowVersion: 1,
      warnings: [],
      idempotentReplay: false,
    });
    expect(store.getSnapshot()).not.toBe(first);
  });

  it("resubmitting a rejected command returns it to submitting", () => {
    const store = new CommandStatusStore();
    store.markSubmitting("cmd-1");
    store.markRejected("cmd-1", "COMMAND_FAILED");
    store.markSubmitting("cmd-1");
    expect(store.get("cmd-1")).toEqual({ state: "submitting" });
  });
});
