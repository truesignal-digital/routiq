import { describe, expect, it } from "vitest";
import { assertMoneyMinor, formatXAF } from "./money.js";

describe("XAF money", () => {
  it("accepts integers", () => {
    expect(assertMoneyMinor(7_400_000)).toBe(7_400_000);
  });

  it("rejects fractional amounts", () => {
    expect(() => assertMoneyMinor(100.5)).toThrow(RangeError);
  });

  it("formats with zero fraction digits", () => {
    expect(formatXAF(408_000, "fr-CM")).not.toMatch(/[.,]00/);
  });
});
