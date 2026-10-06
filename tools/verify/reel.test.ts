import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.js";
import { captionFromLabel, focusClip, type Frame, type RunMetrics } from "./browser.js";
import type { CastIndex } from "./cast.js";
import {
  MAX_GAP,
  appTheme,
  camera,
  compileTimeline,
  compressCast,
  computeLayout,
  frameAt,
  latestDriveRun,
  failureReason,
  metricRows,
  planReel,
  readRun,
  realToReel,
  reelToReal,
  stateAt,
  titleOf,
  type RunSummary,
} from "./reel.js";
import { REPO_ROOT, runDirName } from "./slot.js";

const viewport = { width: 1440, height: 900 };

const frame = (label: string, t?: number, box?: Frame["box"]): Frame => ({
  label,
  caption: captionFromLabel(label),
  file: `${label}.png`,
  frame: `frames/${label}.png`,
  url: "http://x/",
  ...(t === undefined ? {} : { t }),
  ...(box === undefined ? {} : { box }),
});

const metrics = (over: Partial<RunMetrics> = {}): RunMetrics => ({
  apiRequests: 10,
  consoleErrors: 0,
  failedRequests: 0,
  layoutShifts: 2,
  cumulativeLayoutShift: 0.012,
  domNodes: 900,
  ...over,
});

const run = (frames: Frame[], over: Partial<RunSummary> = {}): RunSummary => ({
  dir: "/tmp/run",
  commit: "abcdef1234567",
  account: "nadege",
  role: "FINANCE",
  lang: "en",
  targets: ["flow:approve-from-panel"],
  ok: true,
  steps: [{ step: "log in", ok: true }],
  frames,
  metrics: metrics(),
  cast: undefined,
  ...over,
});

/** Frames painted at these seconds. */
const cast = (times: number[], pauses: CastIndex["pauses"] = []): CastIndex => ({
  viewport,
  frames: times.map((t, i) => ({ file: `${i}.jpg`, t })),
  pauses,
});

describe("planReel", () => {
  it("gives one slot per shot for a single run", () => {
    const slides = planReel(run([frame("queue"), frame("approved")]));
    expect(slides).toMatchObject([
      { kind: "frame", index: 1, total: 2, after: { label: "queue" } },
      { kind: "frame", index: 2, total: 2, after: { label: "approved" } },
    ]);
  });

  it("pairs before and after shots by label, in the after run's order", () => {
    const slides = planReel(run([frame("queue"), frame("panel"), frame("approved")]), run([frame("approved"), frame("queue")]));
    expect(slides.map((s) => (s.kind === "pair" ? [s.before?.label, s.after?.label] : []))).toEqual([
      ["queue", "queue"],
      [undefined, "panel"],
      ["approved", "approved"],
    ]);
  });

  it("puts a failed before run's last frame next to the first screen it never reached", () => {
    const slides = planReel(run([frame("queue"), frame("panel"), frame("approved")]), run([frame("queue"), frame("failed-script-flow")], { ok: false }));
    expect(slides.map((s) => (s.kind === "pair" ? [s.before?.label, s.after?.label] : []))).toEqual([
      ["queue", "queue"],
      ["failed-script-flow", "panel"],
      [undefined, "approved"],
    ]);
  });

  it("keeps screens only the before run had, at the end", () => {
    const slides = planReel(run([frame("queue")]), run([frame("queue"), frame("confirm-dialog")]));
    expect(slides.at(-1)).toMatchObject({ before: { label: "confirm-dialog" }, after: undefined, index: 2, total: 2 });
  });
});

describe("compressCast", () => {
  it("plays busy stretches at real speed and squeezes idle ones", () => {
    const track = compressCast(cast([0.1, 0.2, 0.3, 5.3, 5.4]));
    expect(track.anchors.map((a) => Math.round(a.c * 100) / 100)).toEqual([0.1, 0.2, 0.3, 0.3 + MAX_GAP, 0.4 + MAX_GAP].map((c) => Math.round(c * 100) / 100));
  });

  it("drops frames painted while a screenshot resized or outlined the page", () => {
    const track = compressCast(cast([0.1, 1.0, 1.1, 2.0], [[0.9, 1.15]]));
    expect(track.anchors.map((a) => a.file)).toEqual(["0.jpg", "3.jpg"]);
  });

  it("reads the clock exactly at a shot taken after a long wait with no repaint", () => {
    const track = compressCast(cast([0.5, 1.0]), [31.2]);
    const at = realToReel(track, 31.2);
    expect(at).toBeCloseTo(1.0 + MAX_GAP);
    expect(reelToReal(track, at)).toBeCloseTo(31.2);
    expect(frameAt(track, at)).toBe("1.jpg");
  });

  it("maps real time to reel time and back", () => {
    const track = compressCast(cast([0.5, 1.0, 11.0, 11.5]));
    expect(realToReel(track, 1.0)).toBeCloseTo(1.0);
    expect(realToReel(track, 6.0)).toBeCloseTo(1.0 + MAX_GAP / 2);
    expect(reelToReal(track, realToReel(track, 6.0))).toBeCloseTo(6.0);
    expect(reelToReal(track, realToReel(track, 11.3))).toBeCloseTo(11.3);
    expect(frameAt(track, 1.0 + MAX_GAP + 0.1)).toBe("2.jpg");
  });
});

describe("compileTimeline", () => {
  it("plays each pane up to its shot and holds the faster one so both reach the shot together", () => {
    const after = compressCast(cast([0.5, 1, 1.5, 2, 2.5, 3]));
    const before = compressCast(cast([0.5, 1, 1.5]));
    const slides = planReel(run([frame("queue", 2)]), run([frame("queue", 1)]));
    const { steps } = compileTimeline(slides, [before, after]);
    const step = steps[0];
    expect(step?.play).toBeCloseTo(2);
    expect(step?.panes.map((p) => [p.from, Math.round(p.to * 100) / 100])).toEqual([
      [0, 1],
      [0, 2],
    ]);
  });

  it("stops a pane at its failure and holds it for the rest of the reel", () => {
    const track = compressCast(cast([0.5, 1, 2, 3, 4]));
    const slides = planReel(run([frame("queue", 1), frame("panel", 2), frame("approved", 3)]), run([frame("queue", 1), frame("failed-script", 2)], { ok: false }));
    const { steps } = compileTimeline(slides, [track, track]);
    expect(steps.map((s) => s.panes[0]?.failed)).toEqual([false, true, false]);
    expect(steps[2]?.panes[0]).toMatchObject({ beat: undefined });
    expect(steps[2]?.panes[0]?.from).toBe(steps[2]?.panes[0]?.to);
  });

  it("dwells longer on shots with a highlight, for the zoom", () => {
    const track = compressCast(cast([0.5, 1, 2]));
    const { steps } = compileTimeline(planReel(run([frame("a", 1), frame("b", 2, { x: 10, y: 10, width: 100, height: 40 })])), [track]);
    expect((steps[1]?.dwell ?? 0) > (steps[0]?.dwell ?? 0)).toBe(true);
  });
});

describe("camera", () => {
  const layout = computeLayout(2, viewport);
  const pane = layout.panes[0] ?? { w: 0, h: 0 };
  const box = { x: 300, y: 400, width: 900, height: 40 };

  it("does nothing without a highlight or at zoom 0", () => {
    expect(camera(undefined, viewport, layout.scale, pane, 1)).toEqual({ k: 1, tx: 0, ty: 0 });
    expect(camera(box, viewport, layout.scale, pane, 0)).toEqual({ k: 1, tx: 0, ty: 0 });
  });

  it("zooms in at most to two reel pixels per page pixel and never shows past the frame's edge", () => {
    const cam = camera(box, viewport, layout.scale, pane, 1);
    expect(cam.k * layout.scale).toBeLessThanOrEqual(2 + 1e-9);
    expect(cam.k).toBeGreaterThan(1);
    expect(cam.tx).toBeLessThanOrEqual(0);
    expect(cam.tx).toBeGreaterThanOrEqual(pane.w - layout.scale * cam.k * viewport.width - 1e-6);
    expect(cam.ty).toBeGreaterThanOrEqual(pane.h - layout.scale * cam.k * viewport.height - 1e-6);
  });

  it("centres the highlight", () => {
    const target = { x: 620, y: 430, width: 200, height: 40 };
    const cam = camera(target, viewport, layout.scale, pane, 1);
    const clip = focusClip(target, viewport);
    const centre = layout.scale * cam.k * (clip.x + clip.width / 2) + cam.tx;
    expect(centre).toBeCloseTo(pane.w / 2, 0);
  });
});

describe("computeLayout", () => {
  it("fits panes inside the frame with room for the caption", () => {
    for (const count of [1, 2]) {
      const layout = computeLayout(count, viewport);
      for (const pane of layout.panes) {
        expect(pane.x).toBeGreaterThanOrEqual(0);
        expect(pane.x + pane.w).toBeLessThanOrEqual(1920);
      }
      expect(layout.captionY + 60).toBeLessThanOrEqual(1080);
    }
  });

  it("keeps a phone viewport upright", () => {
    const layout = computeLayout(2, { width: 390, height: 844 });
    expect(layout.panes[0]?.h).toBeGreaterThan(layout.panes[0]?.w ?? Infinity);
  });
});

describe("stateAt", () => {
  const track = compressCast(cast([0.2, 0.6, 1.0, 1.4]));
  const slides = planReel(run([frame("queue", 1.0, { x: 100, y: 100, width: 300, height: 40 })]));
  const timeline = compileTimeline(slides, [track]);
  const layout = computeLayout(1, viewport);
  const at = (time: number) => stateAt(time, timeline, [track], viewport, layout, (_, file) => file);

  it("opens on the title, then plays, then dwells zoomed on the shot, then ends on the measures", () => {
    expect(at(0).intro).toBe(1);
    const step = timeline.steps[0];
    if (step === undefined) throw new Error("no step");
    expect(at(step.start + 0.2).intro).toBe(0);
    const dwellMid = step.start + step.play + step.dwell / 2;
    expect(at(dwellMid).panes[0]?.k).toBeGreaterThan(1);
    expect(at(dwellMid).panes[0]?.ring?.opacity).toBeCloseTo(1);
    expect(at(dwellMid).panes[0]?.note).toBe("Step 1 at 1.0 s");
    expect(at(timeline.total - 0.01).end).toBeCloseTo(1);
  });

  it("shows the real clock, not the reel's", () => {
    const step = timeline.steps[0];
    if (step === undefined) throw new Error("no step");
    expect(at(step.start + step.play + 0.1).panes[0]?.timer).toBe("1.0 s");
  });
});

describe("failureReason", () => {
  it("says what a Playwright timeout means", () => {
    expect(failureReason("Failed here: locator.click: Timeout 30000ms exceeded.")).toBe("couldn't click within 30 s");
    expect(failureReason("Failed here: page.waitForURL: Timeout 10000ms exceeded.")).toBe("couldn't reach the page within 10 s");
    expect(failureReason("Failed here: DLA-2026-00005 is PENDING after approval")).toBe("DLA-2026-00005 is PENDING after approval");
  });
});

describe("metricRows", () => {
  it("marks lower as a win and higher as a loss", () => {
    const rows = metricRows(metrics({ apiRequests: 7, domNodes: 950 }), metrics());
    expect(rows.find((row) => row.label === "API requests")).toMatchObject({ before: "10", after: "7", delta: "−3", tone: "ok" });
    expect(rows.find((row) => row.label === "DOM nodes at the end")).toMatchObject({ delta: "+50", tone: "bad" });
  });

  it("gives no verdict when a run failed and the work differs", () => {
    expect(metricRows(metrics({ apiRequests: 25 }), metrics({ apiRequests: 19 }), false)[0]).toMatchObject({ delta: "+6", tone: "same" });
  });
});

describe("appTheme", () => {
  it("reads the app's colour tokens and font stacks from its stylesheet", () => {
    const theme = appTheme(readFileSync(path.join(REPO_ROOT, "apps/web/src/styles.css"), "utf8"));
    expect(theme.tokens).toContain("--background:");
    expect(theme.tokens).toContain("--foreground:");
    expect(theme.sans).toContain("sans-serif");
    expect(theme.heading).toContain("sans-serif");
  });

  it("fails loudly when the stylesheet changes shape", () => {
    expect(() => appTheme("body {}")).toThrow(/update appTheme/);
  });
});

describe("focusClip", () => {
  it("widens a thin row to a readable 16:10 crop centred on it", () => {
    expect(focusClip({ x: 300, y: 400, width: 900, height: 40 }, viewport)).toEqual({ x: 260, y: 114, width: 980, height: 613 });
  });

  it("stays inside the viewport for an element at the edge", () => {
    const clip = focusClip({ x: 1100, y: 0, width: 340, height: 900 }, viewport);
    expect(clip.x + clip.width).toBeLessThanOrEqual(1440);
    expect(clip).toMatchObject({ y: 0, height: 900, width: 640 });
  });
});

describe("run directories", () => {
  it("refuses a run recorded before frames existed", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "reel-"));
    writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ ok: true, steps: [] }));
    expect(() => readRun(dir)).toThrow(/--reel/);
  });

  it("picks the newest drive run and skips api and up runs", () => {
    const root = mkdtempSync(path.join(tmpdir(), "verify-"));
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 5, 10, minute));
    const newest = `${runDirName("drive", 2, at(20))}-2`;
    for (const name of [runDirName("drive", 1, at(10)), newest, runDirName("api", 1, at(30)), runDirName("up", 1, at(40))]) mkdirSync(path.join(root, name));
    expect(latestDriveRun(root)).toBe(path.join(root, newest));
  });

  it("titles a flow from its name unless given one", () => {
    expect(titleOf(run([]), { title: undefined })).toBe("Approve from panel");
    expect(titleOf(run([]), { title: "Open an approval (#387)" })).toBe("Open an approval (#387)");
  });
});

describe("parseArgs", () => {
  it("takes reel with an optional run directory and a before run", () => {
    expect(parseArgs(["reel", ".verify/a", "--before", ".verify/b", "--title", "Approvals"])).toEqual({ name: "reel", after: ".verify/a", before: ".verify/b", title: "Approvals" });
    expect(parseArgs(["reel"])).toMatchObject({ name: "reel", after: undefined, before: undefined });
  });

  it("takes --reel on drive", () => {
    expect(parseArgs(["drive", "flow:trips", "--reel"])).toMatchObject({ name: "drive", options: { reel: true } });
  });
});
