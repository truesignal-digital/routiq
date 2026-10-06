import { describe as suite, expect, it } from "vitest";
import { describe, named, type Shift } from "./shifts.js";

const shift = (t: number, regions: string[], value = 0.01): Shift => ({ t, value, regions });

suite("named shifts", () => {
  it("keeps shifts that moved a named region and drops the rest", () => {
    const shifts = [shift(100, ["sidebar"]), shift(200, []), shift(300, ["toast"]), shift(400, ["toast", "page"])];
    expect(named(shifts).map((s) => s.t)).toEqual([100, 400]);
  });

  it("names region, phase and time since the step began", () => {
    const lines = describe([shift(1_200, ["header"], 0.0123), shift(2_600, ["sidebar", "page"]), shift(2_700, [])], 1_000, 2_500);
    expect(lines).toEqual(["header while loading at +200 ms (0.0123)", "sidebar+page after ready at +1600 ms (0.0100)"]);
  });
});
