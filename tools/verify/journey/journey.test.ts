import { describe, expect, it } from "vitest";
import path from "node:path";
import { parseArgs } from "../args.js";
import { classifyTarget } from "../browser.js";
import { REPO_ROOT } from "../slot.js";
import { checkBudgets, renderReport, type Budgets, type Journey, type JourneyRun } from "./journey.js";
import type { ScreenMetrics } from "./measure.js";

const budgets: Budgets = {
  taps: 3,
  seconds: 20,
  wordsPerScreen: 80,
  foldWordsPerScreen: 40,
  proseWordsPerScreen: 12,
  longestBlock: 12,
  primaryActionsPerScreen: 1,
  smallTargetsPerScreen: 0,
  axePerScreen: 0,
};

function screen(label: string, over: Partial<ScreenMetrics> = {}): ScreenMetrics {
  return {
    label,
    url: "file:///x",
    viewport: { width: 390, height: 844 },
    root: "main",
    words: 10,
    foldWords: 10,
    proseWords: 0,
    longestBlock: 4,
    proseBlocks: [],
    primaryActions: 1,
    primaryLabels: ["Release"],
    smallTargets: 0,
    smallTargetLabels: [],
    axe: { critical: 0, serious: 0, moderate: 0, minor: 0, ids: [] },
    ...over,
  };
}

const run = (screens: ScreenMetrics[], taps = 3, seconds: number | null = 5): JourneyRun => ({
  journey: "j",
  surface: "app",
  conditions: { viewport: { width: 390, height: 844 }, throttle: "phone", lang: "fr" },
  screens,
  taps,
  seconds,
});

describe("checkBudgets", () => {
  it("passes a run that sits exactly on every limit", () => {
    const checks = checkBudgets(run([screen("a", { words: 80, foldWords: 40, proseWords: 12, longestBlock: 12 })], 3, 20), budgets);
    expect(checks.every((c) => c.pass)).toBe(true);
  });

  it("judges each per-screen budget by its worst screen and names that screen", () => {
    const checks = checkBudgets(run([screen("home", { words: 406 }), screen("vehicle", { words: 246, smallTargets: 10 })]), budgets);
    expect(checks.find((c) => c.budget === "wordsPerScreen")).toEqual({ budget: "wordsPerScreen", limit: 80, actual: 406, screen: "home", pass: false });
    expect(checks.find((c) => c.budget === "smallTargetsPerScreen")).toMatchObject({ actual: 10, screen: "vehicle", pass: false });
  });

  it("fails one tap or one second over", () => {
    const checks = checkBudgets(run([screen("a")], 4, 20.1), budgets);
    expect(checks.find((c) => c.budget === "taps")?.pass).toBe(false);
    expect(checks.find((c) => c.budget === "seconds")?.pass).toBe(false);
  });

  it("leaves seconds out where time means nothing (prototypes)", () => {
    const checks = checkBudgets(run([screen("a")], 3, null), budgets);
    expect(checks.map((c) => c.budget)).not.toContain("seconds");
  });

  it("counts serious and critical axe violations, not moderate ones", () => {
    const checks = checkBudgets(run([screen("a", { axe: { critical: 1, serious: 2, moderate: 5, minor: 9, ids: [] } })]), budgets);
    expect(checks.find((c) => c.budget === "axePerScreen")?.actual).toBe(3);
  });

  it("flags a screen with two filled buttons", () => {
    const checks = checkBudgets(run([screen("a", { primaryActions: 2 })]), budgets);
    expect(checks.find((c) => c.budget === "primaryActionsPerScreen")?.pass).toBe(false);
  });
});

describe("renderReport", () => {
  it("leads with the verdict and quotes the prose the user has to read", () => {
    const journey = { id: "release-to-service", actor: { role: "admin", person: "The Administrateur" }, arrangeAs: "technician", goal: "put a truck back on the road", budgets } as Journey;
    const r = run([screen("vehicle", { proseWords: 18, proseBlocks: [{ words: 18, text: "Repair done — waiting for release to service." }] })]);
    const md = renderReport(journey, r, checkBudgets(r, budgets));
    expect(md.split("\n")[0]).toBe("# Journey release-to-service: FAIL");
    expect(md).toContain("five longest blocks per screen");
    expect(md).toContain("Measured at 390x844, throttle phone, fr.");
    expect(md).toContain("- vehicle (18 words): Repair done — waiting for release to service.");
  });
});

describe("parseArgs measure", () => {
  it("takes prototype targets, a journey and a viewport", () => {
    expect(parseArgs(["measure", "a.html?v=A", "b.html", "--journey", "release-to-service", "--viewport", "390x844"])).toEqual({
      name: "measure",
      targets: ["a.html?v=A", "b.html"],
      journey: "release-to-service",
      viewport: { width: 390, height: 844 },
    });
    expect(() => parseArgs(["measure"])).toThrow(/prototype file/);
  });
});

describe("classifyTarget journey:", () => {
  it("maps journey:<id> to tools/verify/journeys/<id>.ts", () => {
    expect(classifyTarget("journey:release-to-service", "/tmp")).toEqual({ kind: "script", file: path.join(REPO_ROOT, "tools/verify/journeys/release-to-service.ts") });
  });
});
