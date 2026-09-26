import { describe, expect, it } from "vitest";
import { isNotFound, retryUnlessNotFound } from "./query-retry.js";

describe("retrying a read", () => {
  it("never retries a 404", () => {
    expect(retryUnlessNotFound(0, new Error("ASSET_DETAIL_404"))).toBe(false);
    expect(retryUnlessNotFound(0, new Error("REFERENCE_NOT_FOUND"))).toBe(false);
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
