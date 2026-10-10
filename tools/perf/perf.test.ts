import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ceilingFor, judge, median, raise, readCeilings, renderReadme, tighten, tolerance, type Ceilings, type Measured, type Run } from "./perf.js";
import { measurableMetrics, SCREENS, template } from "./run.js";

const time = (value: number) => ({ value, samples: [value], kind: "time" as const });
const count = (value: number) => ({ value, samples: [value], kind: "count" as const });

describe("median", () => {
  it("takes the middle run, or the mean of the two middle ones", () => {
    expect(median([4220, 4523, 4239, 4242, 4254])).toBe(4242);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });
});

describe("tolerance", () => {
  it("lets timings wander by 10% (at least 100 ms), bytes by 1 kB, and counts not at all", () => {
    expect(tolerance("time", 4000)).toBe(400);
    expect(tolerance("time", 300)).toBe(100);
    expect(tolerance("bytes", 500_000)).toBe(1024);
    expect(tolerance("count", 6)).toBe(0);
  });
});

describe("judge", () => {
  const ceilings: Ceilings = { "login.usable_ms": { ceiling: 4000, kind: "time" }, "/.requests": { ceiling: 6, kind: "count" } };

  it("passes inside the band, fails above it, and calls a clear win beaten", () => {
    const verdicts = (measured: Measured) => judge(measured, ceilings).map((v) => [v.name, v.status]);
    expect(verdicts({ "login.usable_ms": time(4350), "/.requests": count(6) })).toEqual([["/.requests", "ok"], ["login.usable_ms", "ok"]]);
    expect(verdicts({ "login.usable_ms": time(4450), "/.requests": count(7) })).toEqual([["/.requests", "over"], ["login.usable_ms", "over"]]);
    expect(verdicts({ "login.usable_ms": time(2500), "/.requests": count(4) })).toEqual([["/.requests", "beaten"], ["login.usable_ms", "beaten"]]);
  });

  it("does not gate the API's p95, which is noise on a shared machine", () => {
    expect(judge({ "api.p95_ms": time(900) }, { "api.p95_ms": { ceiling: 50, kind: "time" } })).toEqual([]);
  });

  it("reports metrics a run added or no longer measures", () => {
    expect(judge({ "/more.ready_ms": time(200) }, ceilings).map((v) => [v.name, v.status])).toEqual([
      ["/.requests", "missing"],
      ["/more.ready_ms", "new"],
      ["login.usable_ms", "missing"],
    ]);
  });
});

describe("tighten", () => {
  it("lowers beaten ceilings with timing headroom, adds new metrics, and never raises one", () => {
    const ceilings: Ceilings = { "login.usable_ms": { ceiling: 4000, kind: "time" }, "/.requests": { ceiling: 6, kind: "count" }, "/assets.ready_ms": { ceiling: 300, kind: "time" } };
    const { next, lowered } = tighten({ "login.usable_ms": time(2500), "/.requests": count(4), "/assets.ready_ms": time(900), "/more.ready_ms": time(200) }, ceilings);
    expect(next).toEqual({
      "login.usable_ms": { ceiling: 2625, kind: "time" },
      "/.requests": { ceiling: 4, kind: "count" },
      "/assets.ready_ms": { ceiling: 300, kind: "time" },
      "/more.ready_ms": { ceiling: 210, kind: "time" },
    });
    expect(lowered).toEqual(["/.requests: 6 → 4", "login.usable_ms: 4000 → 2625"]);
  });
});

describe("raise", () => {
  const ceilings: Ceilings = { "login.usable_ms": { ceiling: 2625, kind: "time" } };

  it("lifts a ceiling only past its band and records why", () => {
    const next = raise({ "login.usable_ms": time(3000) }, ceilings, "login.usable_ms", "Charts on Home are the director's first screen", "2026-10-06");
    expect(next["login.usable_ms"]).toEqual({
      ceiling: ceilingFor(time(3000)),
      kind: "time",
      raises: [{ date: "2026-10-06", from: 2625, to: 3150, reason: "Charts on Home are the director's first screen" }],
    });
    expect(() => raise({ "login.usable_ms": time(2850) }, ceilings, "login.usable_ms", "a long enough reason here", "2026-10-06")).toThrow(/within its ceiling/);
    expect(() => raise({ "login.usable_ms": time(3000) }, ceilings, "login.usable_ms", "slower", "2026-10-06")).toThrow(/reason/);
  });
});

describe("renderReadme", () => {
  it("shows first, previous, today, the change since first, best and ceiling for every metric", () => {
    const run = (at: string, value: number): Run => ({ at, commit: "abc1234", profile: "phone", runs: 5, metrics: { "login.usable_ms": time(value) } });
    const text = renderReadme([run("2026-10-06T10:00:00Z", 3820), run("2026-10-08T10:00:00Z", 2900), run("2026-10-09T10:00:00Z", 2400)], {
      "login.usable_ms": { ceiling: 2520, kind: "time", raises: [{ date: "2026-10-07", from: 2400, to: 2600, reason: "reason" }] },
    });
    expect(text).toContain("| `login.usable_ms` | 3820 ms (2026-10-06) | 2900 ms | 2400 ms | −37% | 2400 ms | 2520 ms |");
    expect(text).toContain("2026-10-07 `login.usable_ms` 2400 → 2600: reason");
    expect(text).toContain("Runs recorded: 3");
  });
});

describe("template", () => {
  it("groups screens by route, not by record", () => {
    expect(template("/assets/0f8fad5b-d9cb-469f-a165-70867728950e")).toBe("/assets/:id");
  });
});

describe("the ceilings file", () => {
  // A ceiling no run can produce fails every `pnpm perf run` as GONE (#574).
  it("gates only metrics a run measures", () => {
    const measurable = new Set(measurableMetrics());
    expect(Object.keys(readCeilings()).filter((name) => !measurable.has(name))).toEqual([]);
  });
});

describe("SCREENS", () => {
  const router = readFileSync(new URL("../../apps/web/src/router.tsx", import.meta.url), "utf8");
  const blocks = router.split("createRoute({");
  const routeBlock = (path: string): string | undefined => {
    const direct = blocks.find((block) => block.includes(`path: "${path}"`));
    if (direct !== undefined) return direct;
    // A child route names only its own segment under a parent route that names the rest (/finance → entries, #664).
    const cut = path.lastIndexOf("/");
    const parentIndex = blocks.findIndex((block) => block.includes(`path: "${path.slice(0, cut)}"`));
    const parentName = parentIndex > 0 ? /const (\w+) = $/.exec(blocks[parentIndex - 1]!.trimEnd() + " ")?.[1] : undefined;
    if (parentName === undefined) return undefined;
    return blocks.find(
      (block) => block.includes(`path: "${path.slice(cut + 1)}"`) && block.includes(`getParentRoute: () => ${parentName},`),
    );
  };

  // A redirect reports its journey under the screen it lands on, so the opened path never gets a ready time.
  it("opens screens the router renders, not redirects", () => {
    const problems = SCREENS.flatMap((screen) => {
      const block = routeBlock(screen.replace(/:\w+/g, "$assetId"));
      if (block === undefined) return [`${screen}: no route`];
      return /\bredirect\(/.test(block) ? [`${screen}: redirects`] : [];
    });
    expect(problems).toEqual([]);
  });
});
