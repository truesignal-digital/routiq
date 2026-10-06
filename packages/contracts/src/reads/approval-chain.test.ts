import { describe, expect, it } from "vitest";
import { approvalChainResponse } from "./approval-chain.js";

describe("approvalChainResponse", () => {
  it("carries the caller's chain per entry kind and the notice to show", () => {
    const body = {
      currency: "XAF",
      chains: [
        {
          commandType: "record-expense",
          steps: [
            { upToMinor: 150_000, outcome: "POSTS_DIRECTLY" },
            { upToMinor: 1_000_000, outcome: "FINANCE_APPROVES" },
            { upToMinor: null, outcome: "DIRECTION_APPROVES" },
          ],
        },
      ],
      notice: {
        changeId: "3f6b2a7c-9d41-4a52-8b0e-2c1d5e6f7a8b",
        changedAt: "2026-10-05T09:00:00.000Z",
        changedBy: "Mme Ngo",
      },
    };
    expect(approvalChainResponse.parse(body)).toEqual(body);
  });

  it("names no one for a change the product made (a migration), and may hold no notice", () => {
    expect(
      approvalChainResponse.safeParse({
        currency: "XAF",
        chains: [],
        notice: {
          changeId: "3f6b2a7c-9d41-4a52-8b0e-2c1d5e6f7a8b",
          changedAt: "2026-10-05T09:00:00.000Z",
          changedBy: null,
        },
      }).success,
    ).toBe(true);
    expect(approvalChainResponse.safeParse({ currency: "XAF", chains: [], notice: null }).success).toBe(
      true,
    );
  });

  it("refuses an outcome it does not know", () => {
    expect(
      approvalChainResponse.safeParse({
        currency: "XAF",
        chains: [{ commandType: "record-expense", steps: [{ upToMinor: null, outcome: "MAYBE" }] }],
        notice: null,
      }).success,
    ).toBe(false);
  });
});
