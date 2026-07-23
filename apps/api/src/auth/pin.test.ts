import { describe, expect, it } from "vitest";
import { hashPin, verifyPin } from "./pin.js";

describe("pin hashing", () => {
  it("verifies a correct PIN against its hash", async () => {
    const hash = await hashPin("4821");
    expect(await verifyPin("4821", hash)).toBe(true);
  });

  it("rejects a wrong PIN", async () => {
    const hash = await hashPin("4821");
    expect(await verifyPin("4822", hash)).toBe(false);
  });

  it("salts hashes (same PIN, different hash)", async () => {
    expect(await hashPin("4821")).not.toBe(await hashPin("4821"));
  });
});
