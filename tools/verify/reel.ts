import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import type { Viewport } from "./args.js";
import { focusClip, type Box, type Frame, type RunMetrics } from "./browser.js";
import type { CastIndex } from "./cast.js";
import { REPO_ROOT, VERIFY_DIR } from "./slot.js";

/** The parts of a drive's summary.json and cast/index.json a reel reads. */
export interface RunSummary {
  dir: string;
  commit: string;
  account: string;
  role: string;
  lang: string;
  targets: string[];
  ok: boolean;
  steps: Array<{ step: string; ok: boolean }>;
  frames: Frame[];
  metrics: RunMetrics | undefined;
  cast: CastIndex | undefined;
}

export type Slide =
  | { kind: "frame"; index: number; total: number; after: Frame }
  | { kind: "pair"; index: number; total: number; before: Frame | undefined; after: Frame | undefined };

export interface ReelOptions {
  title: string | undefined;
}

export function readRun(dir: string): RunSummary {
  const file = path.join(dir, "summary.json");
  if (!existsSync(file)) throw new Error(`${dir} has no summary.json; pass a drive run directory`);
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<RunSummary>;
  if (!Array.isArray(raw.frames)) throw new Error(`${dir} was recorded before reels existed; drive it again with --reel`);
  const castFile = path.join(dir, "cast", "index.json");
  return {
    dir,
    commit: raw.commit ?? "unknown",
    account: raw.account ?? "",
    role: raw.role ?? "",
    lang: raw.lang ?? "",
    targets: raw.targets ?? [],
    ok: raw.ok ?? false,
    steps: raw.steps ?? [],
    frames: raw.frames,
    metrics: raw.metrics,
    cast: existsSync(castFile) ? (JSON.parse(readFileSync(castFile, "utf8")) as CastIndex) : undefined,
  };
}

/** The newest `*-drive-s*` run under .verify/, for `pnpm verify reel` with no directory. */
export function latestDriveRun(root: string = VERIFY_DIR): string {
  const runs = existsSync(root) ? readdirSync(root).filter((name) => /-drive-s\d+(-\d+)?$/.test(name)).sort() : [];
  const last = runs.at(-1);
  if (last === undefined) throw new Error(`no drive runs under ${root}; run pnpm verify drive --reel first`);
  return path.join(root, last);
}

/**
 * One slot per shot. With a before run, shots pair up by label in the after
 * run's order; a failed before run's last frame takes the first slot it never
 * reached, and labels only the before run has come last.
 */
export function planReel(after: RunSummary, before?: RunSummary): Slide[] {
  if (before === undefined) {
    const total = after.frames.length;
    return after.frames.map((frame, i): Slide => ({ kind: "frame", index: i + 1, total, after: frame }));
  }
  const unused = [...before.frames];
  const take = (label: string) => {
    const at = unused.findIndex((frame) => frame.label === label);
    return at === -1 ? undefined : unused.splice(at, 1)[0];
  };
  const pairs = after.frames.map((frame) => ({ before: take(frame.label), after: frame as Frame | undefined }));
  for (const failed of unused.filter((frame) => frame.label.startsWith("failed-"))) {
    const gap = pairs.find((pair) => pair.before === undefined);
    if (gap === undefined) break;
    gap.before = failed;
    unused.splice(unused.indexOf(failed), 1);
  }
  const all = [...pairs, ...unused.map((frame) => ({ before: frame as Frame | undefined, after: undefined }))];
  return all.map((pair, i): Slide => ({ kind: "pair", index: i + 1, total: all.length, ...pair }));
}

export const METRIC_LABELS: Record<keyof RunMetrics, string> = {
  apiRequests: "API requests",
  consoleErrors: "Console errors",
  failedRequests: "Failed requests",
  expectedRefusals: "Expected refusals",
  layoutShifts: "Layout shifts",
  cumulativeLayoutShift: "Cumulative layout shift",
  domNodes: "DOM nodes at the end",
};

/**
 * Except expected refusals (informational), every metric is lower-is-better, so a negative delta is a win. Pass
 * comparable = false when either run failed: the runs did different amounts of
 * work, so deltas are shown without a verdict.
 */
export function metricRows(
  after: RunMetrics | undefined,
  before?: RunMetrics,
  comparable = true,
): Array<{ label: string; after: string; before?: string; delta?: string; tone: "ok" | "bad" | "same" }> {
  if (after === undefined) return [];
  return (Object.keys(METRIC_LABELS) as Array<keyof RunMetrics>).map((key) => {
    const a = after[key] ?? 0;
    const b = before === undefined ? undefined : (before[key] ?? 0);
    const tone = key === "expectedRefusals" || b === undefined || a === b || !comparable ? "same" : a < b ? "ok" : "bad";
    const round = (n: number) => String(Math.round(n * 10_000) / 10_000);
    return {
      label: METRIC_LABELS[key],
      after: round(a),
      ...(b === undefined ? {} : { before: round(b), delta: a === b ? "±0" : `${a > b ? "+" : "−"}${round(Math.abs(a - b))}` }),
      tone,
    };
  });
}

// ---------------------------------------------------------------------------
// Time: a cast is replayed at real speed, except idle stretches, which play at
// MAX_GAP so a 30 s timeout doesn't fill the reel. The on-screen clock stays real.

export const MAX_GAP = 0.6;

export interface Track {
  /** r: real seconds into the cast; c: reel seconds; file: the frame painted at r. */
  anchors: Array<{ r: number; c: number; file: string }>;
}

/**
 * Beats (shot times) become anchors too, holding the last painted frame, so the
 * clock reads exactly at every shot even when nothing repainted, as when a step
 * waits out a 30 s timeout.
 */
export function compressCast(cast: CastIndex, beats: readonly number[] = []): Track {
  const hidden = (t: number) => cast.pauses.some(([from, to]) => t >= from && t <= to);
  const events = [
    ...cast.frames.filter((frame) => !hidden(frame.t)).map((frame) => ({ t: frame.t, file: frame.file as string | undefined })),
    ...beats.map((t) => ({ t, file: undefined })),
  ].sort((a, b) => a.t - b.t);
  if (!events.some((event) => event.file !== undefined)) throw new Error("the cast has no frames to play");
  const anchors: Track["anchors"] = [];
  let r = 0;
  let c = 0;
  let file = events.find((event) => event.file !== undefined)?.file ?? "";
  for (const event of events) {
    c += Math.min(Math.max(event.t - r, 0), MAX_GAP);
    r = Math.max(event.t, r);
    file = event.file ?? file;
    anchors.push({ r, c, file });
  }
  return { anchors };
}

/** The last anchor at or before `value` on the given axis, or -1 before the first. */
function anchorIndex(track: Track, axis: "r" | "c", value: number): number {
  const first = track.anchors[0];
  if (first === undefined || value < first[axis]) return -1;
  let lo = 0;
  let hi = track.anchors.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((track.anchors[mid]?.[axis] ?? Infinity) <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Piecewise-linear between anchors; before the first anchor the lead-in is squeezed the same way. */
function mapTime(track: Track, from: "r" | "c", to: "r" | "c", value: number): number {
  const i = anchorIndex(track, from, value);
  const first = track.anchors[0];
  if (i === -1 || first === undefined) return first === undefined || first[from] <= 0 ? 0 : (value / first[from]) * first[to];
  const a = track.anchors[i];
  const next = track.anchors[i + 1];
  if (a === undefined) return 0;
  if (next === undefined) return from === "r" ? a.c + Math.min(value - a.r, MAX_GAP) : a.r + (value - a.c);
  const span = next[from] - a[from];
  return span <= 0 ? a[to] : a[to] + ((value - a[from]) * (next[to] - a[to])) / span;
}

export const realToReel = (track: Track, r: number) => mapTime(track, "r", "c", r);
export const reelToReal = (track: Track, c: number) => mapTime(track, "c", "r", c);

export function frameAt(track: Track, c: number): string {
  return track.anchors[Math.max(anchorIndex(track, "c", c), 0)]?.file ?? "";
}

// ---------------------------------------------------------------------------
// The timeline: an intro, one step per slot (play up to the shot, then dwell
// on it while the camera eases into the highlight), and the measurements.

export const FPS = 30;
const INTRO = 1.5;
const FADE = 0.4;
const DWELL = 1.6;
const DWELL_ZOOM = 2.6;
const END = 4.5;

export interface StepPane {
  from: number;
  to: number;
  beat: Frame | undefined;
  failed: boolean;
}

export interface Step {
  start: number;
  play: number;
  dwell: number;
  caption: string;
  panes: StepPane[];
}

export interface Timeline {
  steps: Step[];
  endStart: number;
  total: number;
}

export function compileTimeline(slides: readonly Slide[], tracks: readonly Track[]): Timeline {
  const prev = tracks.map(() => 0);
  const stopped = tracks.map(() => false);
  const steps: Step[] = [];
  let t = INTRO;
  for (const slide of slides) {
    const beats = slide.kind === "frame" ? [slide.after] : [slide.before, slide.after];
    const panes = beats.map((beat, i): StepPane => {
      const from = prev[i] ?? 0;
      const track = tracks[i];
      if (stopped[i] || beat?.t === undefined || track === undefined) return { from, to: from, beat: stopped[i] ? undefined : beat, failed: false };
      return { from, to: Math.max(from, realToReel(track, beat.t)), beat, failed: beat.label.startsWith("failed-") };
    });
    const play = Math.max(0.3, ...panes.map((pane) => pane.to - pane.from));
    const dwell = panes.some((pane) => pane.beat?.box !== undefined) ? DWELL_ZOOM : DWELL;
    const caption = slide.kind === "frame" ? slide.after.caption : (slide.after?.caption ?? slide.before?.caption ?? "");
    steps.push({ start: t, play, dwell, caption, panes });
    panes.forEach((pane, i) => {
      prev[i] = pane.to;
      if (pane.failed) stopped[i] = true;
    });
    t += play + dwell;
  }
  return { steps, endStart: t, total: t + END };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};

/** 0 → 1 → 0 across a dwell: ease in, hold, ease out before the next step plays. */
export function zoomCurve(t: number, dwell: number): number {
  return ease(t / 0.55) * (1 - ease((t - (dwell - 0.5)) / 0.5));
}

export interface Layout {
  width: number;
  height: number;
  panes: Array<{ x: number; y: number; w: number; h: number }>;
  /** Reel pixels per viewport pixel at zoom 1. */
  scale: number;
  captionY: number;
}

export function computeLayout(count: number, viewport: Viewport, width = 1920, height = 1080): Layout {
  const side = 72;
  const gap = 40;
  const top = 40;
  const header = 76;
  const captionArea = 150;
  const paneW = (width - side * 2 - gap * (count - 1)) / count;
  const availH = height - top - header - captionArea;
  const scale = Math.min(paneW / viewport.width, availH / viewport.height);
  const w = viewport.width * scale;
  const h = viewport.height * scale;
  const row = count * w + (count - 1) * gap;
  const x0 = (width - row) / 2;
  const y = top + header + (availH - h) / 2;
  return { width, height, scale, captionY: y + h + 32, panes: Array.from({ length: count }, (_, i) => ({ x: x0 + i * (w + gap), y, w, h })) };
}

/** The image transform that puts the highlight at the centre of the pane at zoom progress z. */
export function camera(box: Box | undefined, viewport: Viewport, scale: number, pane: { w: number; h: number }, z: number): { k: number; tx: number; ty: number } {
  if (box === undefined || z <= 0) return { k: 1, tx: 0, ty: 0 };
  const clip = focusClip(box, viewport);
  // Frames are captured at viewport size; zooming past 2 reel pixels per page pixel would blur.
  const zoom = Math.max(1, Math.min(2 / scale, viewport.width / clip.width, viewport.height / clip.height));
  const k = 1 + (zoom - 1) * z;
  const fit = (centre: number, size: number, span: number) => Math.min(0, Math.max(span - scale * k * size, (span / 2 - scale * zoom * centre) * z));
  return { k, tx: fit(clip.x + clip.width / 2, viewport.width, pane.w), ty: fit(clip.y + clip.height / 2, viewport.height, pane.h) };
}

export interface PaneState {
  src: string;
  timer: string;
  note: string;
  noteTone: "muted" | "bad";
  k: number;
  tx: number;
  ty: number;
  ring: { x: number; y: number; w: number; h: number; opacity: number } | undefined;
}

export interface FrameState {
  panes: PaneState[];
  caption: string;
  captionOpacity: number;
  intro: number;
  end: number;
}

const seconds = (r: number) => `${r.toFixed(1)} s`;
/** "Failed here: locator.click: Timeout 30000ms exceeded." → "couldn't click within 30 s". */
export function failureReason(caption: string): string {
  const detail = caption.replace(/^Failed here:\s*/, "").replace(/\.$/, "");
  const timeout = /(?:locator|page)\.(\w+): Timeout (\d+)ms exceeded/.exec(detail);
  if (timeout !== null) {
    const verbs: Record<string, string> = { click: "click", fill: "type", waitFor: "find the element", waitForURL: "reach the page" };
    return `couldn't ${verbs[timeout[1] ?? ""] ?? timeout[1]} within ${Number(timeout[2]) / 1000} s`;
  }
  return detail.slice(0, 56);
}

export function stateAt(time: number, timeline: Timeline, tracks: readonly Track[], viewport: Viewport, layout: Layout, srcFor: (pane: number, file: string) => string): FrameState {
  const current = [...timeline.steps].reverse().find((step) => step.start <= time);
  const panes = tracks.map((track, i): PaneState => {
    let c = 0;
    let note = "";
    let noteTone: PaneState["noteTone"] = "muted";
    let zoom = 0;
    let box: Box | undefined;
    for (const [n, step] of timeline.steps.entries()) {
      if (step.start > time) break;
      const pane = step.panes[i];
      if (pane === undefined) continue;
      const local = time - step.start;
      if (noteTone !== "bad") note = "";
      c = local < step.play ? Math.min(pane.from + local, pane.to) : pane.to;
      if (local >= pane.to - pane.from && pane.beat !== undefined) {
        const at = seconds(reelToReal(track, pane.to));
        if (pane.failed) {
          note = `Stopped at ${at}: ${failureReason(pane.beat.caption)}`;
          noteTone = "bad";
        } else if (noteTone !== "bad") note = `Step ${n + 1} at ${at}`;
      }
      if (step === current && local >= step.play && pane.beat?.box !== undefined && time < timeline.endStart) {
        zoom = zoomCurve(local - step.play, step.dwell);
        box = pane.beat.box;
      }
    }
    const pane = layout.panes[i] ?? { w: 0, h: 0 };
    const cam = camera(box, viewport, layout.scale, pane, zoom);
    const pad = 8;
    const ring =
      box === undefined || zoom <= 0.01
        ? undefined
        : {
            x: layout.scale * cam.k * (box.x - pad) + cam.tx,
            y: layout.scale * cam.k * (box.y - pad) + cam.ty,
            w: layout.scale * cam.k * (box.width + pad * 2),
            h: layout.scale * cam.k * (box.height + pad * 2),
            opacity: zoom,
          };
    return { src: srcFor(i, frameAt(track, c)), timer: seconds(reelToReal(track, c)), note, noteTone, ...cam, ring };
  });
  return {
    panes,
    caption: current?.caption ?? "",
    captionOpacity: current === undefined || time >= timeline.endStart ? 0 : ease((time - current.start - current.play) / 0.35),
    intro: time < INTRO ? 1 - ease((time - (INTRO - FADE)) / FADE) : 0,
    end: time >= timeline.endStart ? ease((time - timeline.endStart) / FADE) : 0,
  };
}

// ---------------------------------------------------------------------------
// Look: the app's own fonts and colour tokens, read from its stylesheet.

export interface AppTheme {
  tokens: string;
  sans: string;
  heading: string;
}

export function appTheme(css: string): AppTheme {
  const tokens = /:root\s*\{([^}]*)\}/.exec(css)?.[1];
  const sans = /--font-sans:\s*([^;]+);/.exec(css)?.[1];
  const heading = /--font-heading:\s*([^;]+);/.exec(css)?.[1];
  if (tokens === undefined || sans === undefined || heading === undefined) {
    throw new Error("apps/web/src/styles.css no longer has :root tokens, --font-sans and --font-heading; update appTheme in tools/verify/reel.ts");
  }
  return { tokens: tokens.trim(), sans: sans.trim(), heading: heading.trim() };
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const short = (commit: string) => `${commit.slice(0, 7)}${commit.endsWith("-dirty") ? "-dirty" : ""}`;

export function titleOf(run: RunSummary, options: ReelOptions): string {
  if (options.title !== undefined) return options.title;
  const target = run.targets.join(" ").replace(/^flow:/, "").replace(/[-_]+/g, " ");
  return target.charAt(0).toUpperCase() + target.slice(1);
}

function playerHtml(theme: AppTheme, layout: Layout, runs: readonly RunSummary[], labels: readonly string[], title: string, end: string): string {
  const after = runs.at(-1);
  const role = after === undefined ? "" : after.role.charAt(0) + after.role.slice(1).toLowerCase();
  const who = after === undefined ? "" : `${escape(after.account)} · ${escape(role)} · ${escape(after.lang)}`;
  const subtitle = runs.length > 1 ? `Before ${short(runs[0]?.commit ?? "")}, after ${short(after?.commit ?? "")}` : `Commit ${short(after?.commit ?? "")}`;
  const panes = layout.panes
    .map(
      (pane, i) => `
<section class="pane" style="left:${pane.x}px;top:${pane.y - 76}px;width:${pane.w}px">
  <div class="head"><span class="label">${escape(labels[i] ?? "")}</span><span class="timer" id="timer${i}"></span></div>
  <div class="note" id="note${i}"></div>
</section>
<div class="window" style="left:${pane.x}px;top:${pane.y}px;width:${pane.w}px;height:${pane.h}px">
  <img id="img${i}" style="width:${pane.w}px;height:${pane.h}px">
  <div class="ring" id="ring${i}"></div>
</div>`,
    )
    .join("");
  const x0 = layout.panes[0]?.x ?? 0;
  const lastPane = layout.panes.at(-1);
  const captionW = lastPane === undefined ? 0 : lastPane.x + lastPane.w - x0;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
:root { ${theme.tokens} --font-sans: ${theme.sans}; --font-heading: ${theme.heading}; }
* { box-sizing: border-box; margin: 0; }
html, body { width: ${layout.width}px; height: ${layout.height}px; overflow: hidden; }
body { background: var(--muted); color: var(--foreground); font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }
.pane { position: absolute; height: 76px; }
.head { display: flex; justify-content: space-between; align-items: baseline; }
.label { font-family: var(--font-heading); font-weight: 650; font-size: 26px; letter-spacing: -0.01em; }
.timer { font-family: var(--font-heading); font-size: 24px; font-variant-numeric: tabular-nums; color: var(--muted-foreground); }
.note { margin-top: 6px; font-size: 19px; color: var(--muted-foreground); min-height: 24px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.note.bad { color: var(--destructive); }
.window { position: absolute; overflow: hidden; background: var(--background); border-radius: calc(var(--radius) * 1.4); box-shadow: 0 0 0 1px var(--border), 0 12px 32px -12px oklch(0 0 0 / 18%); }
.window img { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.ring { position: absolute; border: 3px solid var(--primary); border-radius: var(--radius); box-shadow: 0 0 0 6px oklch(0.205 0 0 / 10%); opacity: 0; }
.caption { position: absolute; left: ${x0}px; top: ${layout.captionY}px; width: ${captionW}px; font-size: 34px; font-weight: 550; line-height: 1.3; }
.overlay { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; padding: 0 160px; gap: 20px; opacity: 0; }
#intro { background: var(--muted); }
#end { background: var(--background); }
.kicker { font-size: 22px; color: var(--muted-foreground); }
h1 { font-family: var(--font-heading); font-weight: 700; font-size: 60px; letter-spacing: -0.02em; line-height: 1.1; }
.sub { font-size: 26px; color: var(--muted-foreground); }
table { border-collapse: collapse; font-size: 26px; margin-top: 12px; }
th { text-align: left; font-weight: 500; font-size: 20px; color: var(--muted-foreground); padding: 0 56px 10px 0; }
td { padding: 10px 56px 10px 0; border-top: 1px solid var(--border); font-variant-numeric: tabular-nums; }
.ok { color: var(--success-foreground); font-weight: 600; } .bad { color: var(--destructive); font-weight: 600; } .same { color: var(--muted-foreground); }
.verdict { font-size: 26px; }
</style></head><body>
${panes}
<div class="caption" id="caption"></div>
<div class="overlay" id="intro"><div class="kicker">${who}</div><h1>${escape(title)}</h1><div class="sub">${escape(subtitle)}</div></div>
<div class="overlay" id="end">${end}</div>
<script>
window.__render = async (s) => {
  const loads = [];
  s.panes.forEach((p, i) => {
    const img = document.getElementById("img" + i);
    if (img.getAttribute("src") !== p.src) { img.setAttribute("src", p.src); loads.push(img.decode().catch(() => {})); }
    img.style.transform = "translate(" + p.tx + "px," + p.ty + "px) scale(" + p.k + ")";
    document.getElementById("timer" + i).textContent = p.timer;
    const note = document.getElementById("note" + i);
    note.textContent = p.note;
    note.className = "note" + (p.noteTone === "bad" ? " bad" : "");
    const ring = document.getElementById("ring" + i);
    if (p.ring) Object.assign(ring.style, { left: p.ring.x + "px", top: p.ring.y + "px", width: p.ring.w + "px", height: p.ring.h + "px", opacity: p.ring.opacity });
    else ring.style.opacity = 0;
  });
  const caption = document.getElementById("caption");
  caption.textContent = s.caption;
  caption.style.opacity = s.captionOpacity;
  document.getElementById("intro").style.opacity = s.intro;
  document.getElementById("end").style.opacity = s.end;
  await Promise.all(loads);
};
</script></body></html>`;
}

function endHtml(after: RunSummary, before: RunSummary | undefined): string {
  const comparable = before === undefined || (before.ok && after.ok);
  const rows = metricRows(after.metrics, before?.metrics, comparable);
  const passed = after.steps.filter((step) => step.ok).length;
  const verdict = after.ok ? `<span class="ok">Drive passed</span>` : `<span class="bad">Drive failed</span>`;
  const head = before === undefined ? "<tr><th>Measure</th><th>Value</th></tr>" : "<tr><th>Measure</th><th>Before</th><th>After</th><th>Change</th></tr>";
  const body = rows
    .map((row) =>
      before === undefined
        ? `<tr><td>${row.label}</td><td>${row.after}</td></tr>`
        : `<tr><td>${row.label}</td><td>${row.before ?? "–"}</td><td>${row.after}</td><td class="${row.tone}">${row.delta ?? ""}</td></tr>`,
    )
    .join("");
  const note = comparable ? "" : `<div class="sub">The ${before?.ok === false ? "before" : "after"} run stopped early, so the runs did different work. Compare the counts, don't score them.</div>`;
  return `<h1>What the run measured</h1><div class="verdict">${verdict} <span class="same">· ${passed} of ${after.steps.length} steps · commit ${short(after.commit)}</span></div><table>${head}${body}</table>${note}`;
}

function sheetHtml(theme: AppTheme, after: RunSummary, title: string): string {
  const cells = after.frames
    .map((frame, i) => `<figure><img src="${pathToFileURL(path.join(after.dir, frame.frame)).href}"><figcaption><b>${i + 1}</b> ${escape(frame.caption)}</figcaption></figure>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
:root { ${theme.tokens} }
* { box-sizing: border-box; margin: 0; }
body { width: 1600px; background: var(--muted); color: var(--foreground); font: 400 18px/1.4 ${theme.sans}; padding: 40px; }
h1 { font: 700 30px/1.2 ${theme.heading}; margin-bottom: 24px; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; }
figure { display: flex; flex-direction: column; gap: 10px; }
img { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; object-position: top; background: var(--background); border-radius: calc(var(--radius) * 1.4); box-shadow: 0 0 0 1px var(--border); }
b { font-family: ${theme.heading}; margin-right: 6px; }
</style></head><body><h1>${escape(title)} · ${short(after.commit)}</h1><div class="grid">${cells}</div></body></html>`;
}

/**
 * Replays one --reel drive, or a before and an after drive side by side, as an
 * mp4 rendered frame by frame at 30 fps, plus reel-sheet.png. Writes into the
 * after run's directory and returns the paths and the measured length.
 */
export async function buildReel(afterDir: string, beforeDir: string | undefined, options: ReelOptions): Promise<{ mp4: string; sheet: string; seconds: number }> {
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) throw new Error("ffmpeg is not on PATH (brew install ffmpeg)");
  const after = readRun(afterDir);
  const before = beforeDir === undefined ? undefined : readRun(beforeDir);
  const runs = before === undefined ? [after] : [before, after];
  const casts = runs.map((run) => {
    if (run.cast === undefined) throw new Error(`${run.dir} has no screen recording; drive it again with --reel`);
    return run.cast;
  });
  if (after.frames.length === 0) throw new Error(`${afterDir} has no shots; a reel needs at least one shot()`);

  const viewport = casts.at(-1)?.viewport ?? { width: 1440, height: 900 };
  const tracks = casts.map((cast, i) => compressCast(cast, (runs[i]?.frames ?? []).flatMap((frame) => (frame.t === undefined ? [] : [frame.t]))));
  const timeline = compileTimeline(planReel(after, before), tracks);
  const layout = computeLayout(runs.length, viewport);
  const theme = appTheme(readFileSync(path.join(REPO_ROOT, "apps/web/src/styles.css"), "utf8"));
  const title = titleOf(after, options);
  const labels = before === undefined ? [after.account] : [`Before · ${short(before.commit)}`, `After · ${short(after.commit)}`];

  const name = before === undefined ? "reel" : "reel-compare";
  const work = path.join(afterDir, name);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const player = path.join(work, "player.html");
  writeFileSync(player, playerHtml(theme, layout, runs, labels, title, endHtml(after, before)));
  const srcFor = (pane: number, file: string) => pathToFileURL(path.join(runs[pane]?.dir ?? "", "cast", file)).href;

  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage({ viewport: { width: layout.width, height: layout.height } });
    await tab.goto(pathToFileURL(player).href);
    await tab.evaluate(() => document.fonts.ready.then(() => undefined));
    const count = Math.round(timeline.total * FPS);
    let lastKey = "";
    let lastFile = "";
    for (let n = 0; n < count; n += 1) {
      const state = stateAt(n / FPS, timeline, tracks, viewport, layout, srcFor);
      const file = path.join(work, `${String(n).padStart(6, "0")}.jpg`);
      const key = JSON.stringify(state, (_, value: unknown) => (typeof value === "number" ? Math.round(value * 100) / 100 : value));
      if (key === lastKey) {
        copyFileSync(lastFile, file);
        continue;
      }
      await tab.evaluate((s) => (window as unknown as { __render: (s: FrameState) => Promise<void> }).__render(s), state);
      await tab.screenshot({ path: file, type: "jpeg", quality: 92 });
      lastKey = key;
      lastFile = file;
    }

    const sheet = path.join(work, "sheet.html");
    writeFileSync(sheet, sheetHtml(theme, after, title));
    const sheetTab = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await sheetTab.goto(pathToFileURL(sheet).href);
    await sheetTab.screenshot({ path: path.join(afterDir, "reel-sheet.png"), fullPage: true });
  } finally {
    await browser.close();
  }

  const mp4 = path.join(afterDir, `${name}.mp4`);
  const encode = spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(work, "%06d.jpg"), "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4],
    { encoding: "utf8" },
  );
  if (encode.status !== 0) throw new Error(`ffmpeg failed: ${encode.stderr.trim()}`);
  for (const file of readdirSync(work)) if (file.endsWith(".jpg")) rmSync(path.join(work, file));
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4], { encoding: "utf8" });
  const length = Number(probe.stdout.trim());
  if (!Number.isFinite(length) || Math.abs(length - timeline.total) > 0.5) throw new Error(`${mp4} runs ${probe.stdout.trim()} s, expected ${timeline.total.toFixed(1)} s`);
  return { mp4, sheet: path.join(afterDir, "reel-sheet.png"), seconds: Math.round(length) };
}
