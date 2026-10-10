import { describe, expect, it } from "vitest";
import { isNotFound, retryRead, retryUnlessNotFound } from "./query-retry.js";

describe("retrying a read", () => {
  it("never retries a 404", () => {
    expect(retryUnlessNotFound(0, new Error("ASSET_DETAIL_404"))).toBe(false);
    expect(retryUnlessNotFound(0, new Error("REFERENCE_NOT_FOUND"))).toBe(false);
  });

  it("never retries a refusal: the same request is refused again (#600)", () => {
    for (const message of ["MEMBERS_401", "MEMBERS_403", "ENTRY_404", "ENTRIES_409", "AUTH_REQUIRED"]) {
      expect(retryUnlessNotFound(0, new Error(message))).toBe(false);
    }
  });

  it("retries any other failure twice", () => {
    const failure = new Error("ASSET_DETAIL_500");
    expect([0, 1, 2].map((count) => retryUnlessNotFound(count, failure))).toEqual([true, true, false]);
    expect(retryUnlessNotFound(0, new TypeError("Failed to fetch"))).toBe(true);
  });

  it("reads the status off the message's tail only", () => {
    expect(isNotFound(new Error("ATTENTION_404"))).toBe(true);
    expect(isNotFound(new Error("ATTENTION_4040"))).toBe(false);
    expect(isNotFound("ASSET_DETAIL_404")).toBe(false);
  });
});

describe("the app's default read retry (#600)", () => {
  it("never retries 401, 403, 404 or 409, which answer the same the next time", () => {
    for (const message of [
      "MEMBERS_401",
      "MEMBERS_403",
      "ACTIVITY_404",
      "ENTRIES_409",
      "AUTH_REQUIRED",
      "REFERENCE_NOT_FOUND",
    ]) {
      expect(retryRead(0, new Error(message)), message).toBe(false);
    }
  });

  it("retries a server failure or a dropped connection three times, like the library default", () => {
    for (const failure of [new Error("MEMBERS_500"), new Error("ENTRIES_429"), new TypeError("Failed to fetch")]) {
      expect([0, 1, 2, 3].map((count) => retryRead(count, failure))).toEqual([true, true, true, false]);
    }
  });
});
