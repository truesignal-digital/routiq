import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The performance ledger. A run measures every metric a few times on the
 * pilot-phone profile and keeps the median. Ceilings may only go down:
 * `pnpm perf tighten` lowers them when a run beats them, and raising one needs
 * `pnpm perf raise` with a reason. Every recorded run is appended to
 * docs/performance/history.jsonl, which is how "what was it before" is answered.
 */

export type Kind = "time" | "count" | "bytes";

export interface Sample {
  /** Median over the runs. */
  value: number;
  samples: number[];
  kind: Kind;
}

export type Measured = Record<string, Sample>;

export interface Run {
  at: string;
  commit: string;
  profile: string;
  runs: number;
  metrics: Measured;
  /** Metrics some runs did not produce; a run with any is not trustworthy and is never recorded. */
  incomplete?: string[];
}

export interface Raise {
  date: string;
  from: number;
  to: number;
  reason: string;
}

export type Ceilings = Record<string, { ceiling: number; kind: Kind; raises?: Raise[] }>;

const HERE = (file: string) => fileURLToPath(new URL(file, import.meta.url));
export const CEILINGS_PATH = HERE("./ceilings.json");
export const HISTORY_PATH = HERE("../../docs/performance/history.jsonl");
export const README_PATH = HERE("../../docs/performance/README.md");

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * How far a run may sit above its ceiling and still pass. Timings on a
 * throttled browser wander between runs: ±30 ms on a 4 s load on a quiet
 * machine, ±250 ms when other slots and test suites share it. Counts are
 * exact; byte sizes move with the commit hash baked in.
 */
export function tolerance(kind: Kind, ceiling: number): number {
  if (kind === "time") return Math.max(100, ceiling * 0.1);
  if (kind === "bytes") return 1024;
  return 0;
}

/**
 * Recorded and shown, but never gated: the API's p95 over one run is a handful
 * of requests on a shared machine, and it read 50, 177, 202, 445 and 527 ms
 * across runs of identical API code.
 */
export const isGated = (name: string) => !name.startsWith("api.");

export type Verdict =
  | { name: string; status: "new"; value: number }
  | { name: string; status: "ok" | "over" | "beaten"; value: number; ceiling: number }
  | { name: string; status: "missing"; ceiling: number };

/** "beaten" means the run is clearly under the ceiling: tighten to lock the gain in. */
export function judge(measured: Measured, ceilings: Ceilings): Verdict[] {
  const names = [...new Set([...Object.keys(ceilings), ...Object.keys(measured)])].filter(isGated).sort();
  return names.map((name): Verdict => {
    const sample = measured[name];
    const ceiling = ceilings[name];
    if (sample === undefined) return { name, status: "missing", ceiling: ceiling?.ceiling ?? 0 };
    if (ceiling === undefined) return { name, status: "new", value: sample.value };
    const band = tolerance(ceiling.kind, ceiling.ceiling);
    if (sample.value > ceiling.ceiling + band) return { name, status: "over", value: sample.value, ceiling: ceiling.ceiling };
    if (sample.value < ceiling.ceiling - band) return { name, status: "beaten", value: sample.value, ceiling: ceiling.ceiling };
    return { name, status: "ok", value: sample.value, ceiling: ceiling.ceiling };
  });
}

/** A ceiling sits just above the measured value: exact for counts, a little headroom for noisy timings. */
export function ceilingFor(sample: Sample): number {
  if (sample.kind === "time") return Math.ceil(sample.value * 1.05);
  return Math.ceil(sample.value);
}

/** Lowers beaten ceilings and adds new metrics; never raises one. */
export function tighten(measured: Measured, ceilings: Ceilings): { next: Ceilings; lowered: string[] } {
  const next: Ceilings = { ...ceilings };
  const lowered: string[] = [];
  for (const verdict of judge(measured, ceilings)) {
    const sample = measured[verdict.name];
    if (sample === undefined) continue;
    if (verdict.status === "new") next[verdict.name] = { ceiling: ceilingFor(sample), kind: sample.kind };
    if (verdict.status === "beaten") {
      const current = ceilings[verdict.name];
      const target = Math.min(ceilingFor(sample), current?.ceiling ?? Infinity);
      next[verdict.name] = { ...(current ?? { kind: sample.kind }), ceiling: target };
      lowered.push(`${verdict.name}: ${current?.ceiling} → ${target}`);
    }
  }
  return { next, lowered };
}

export function raise(measured: Measured, ceilings: Ceilings, name: string, reason: string, date: string): Ceilings {
  if (reason.trim().length < 15) throw new Error("--reason must say why the slower number is worth it (15 characters or more)");
  const current = ceilings[name];
  const sample = measured[name];
  if (current === undefined || sample === undefined) throw new Error(`${name} has no ceiling or no measurement in the last run`);
  if (sample.value <= current.ceiling + tolerance(current.kind, current.ceiling)) throw new Error(`${name} is within its ceiling; nothing to raise`);
  const to = ceilingFor(sample);
  return { ...ceilings, [name]: { ...current, ceiling: to, raises: [...(current.raises ?? []), { date, from: current.ceiling, to, reason: reason.trim() }] } };
}

export function readCeilings(file = CEILINGS_PATH): Ceilings {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Ceilings) : {};
}

export function writeCeilings(ceilings: Ceilings, file = CEILINGS_PATH): void {
  const sorted = Object.fromEntries(Object.entries(ceilings).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
}

export function readHistory(file = HISTORY_PATH): Run[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Run);
}

const unit = (kind: Kind) => ({ time: "ms", count: "", bytes: "kB" })[kind];
const show = (value: number | undefined, kind: Kind) =>
  value === undefined || Number.isNaN(value) ? "–" : kind === "bytes" ? `${(value / 1024).toFixed(1)} ${unit(kind)}` : `${Math.round(value)}${unit(kind) ? ` ${unit(kind)}` : ""}`;

/** The before-and-today table: first recorded value, the previous run, today, the best ever, and the ceiling. */
export function renderReadme(history: readonly Run[], ceilings: Ceilings): string {
  const names = [...new Set([...history.flatMap((run) => Object.keys(run.metrics)), ...Object.keys(ceilings)])].sort();
  const latest = history.at(-1);
  const previous = history.at(-2);
  const rows = names.map((name) => {
    const seen = history.filter((run) => run.metrics[name] !== undefined);
    const first = seen[0];
    const kind = first?.metrics[name]?.kind ?? ceilings[name]?.kind ?? "time";
    const best = seen.length === 0 ? undefined : Math.min(...seen.map((run) => run.metrics[name]?.value ?? Infinity));
    const today = latest?.metrics[name]?.value;
    const firstValue = first?.metrics[name]?.value;
    const pct = firstValue === undefined || today === undefined || firstValue === 0 ? undefined : Math.round(((today - firstValue) / firstValue) * 100);
    const change = pct === undefined ? "–" : pct === 0 ? "0%" : `${pct < 0 ? "−" : "+"}${Math.abs(pct)}%`;
    return `| \`${name}\` | ${show(firstValue, kind)} (${first?.at.slice(0, 10) ?? "–"}) | ${show(previous?.metrics[name]?.value, kind)} | ${show(today, kind)} | ${change} | ${show(best, kind)} | ${show(ceilings[name]?.ceiling, kind)} |`;
  });
  const raises = Object.entries(ceilings).flatMap(([name, c]) => (c.raises ?? []).map((r) => `- ${r.date} \`${name}\` ${r.from} → ${r.to}: ${r.reason}`));
  return `# Performance ledger

Generated by \`pnpm perf run --record\`; do not edit by hand. Every number is the median of several runs of the built app on the pilot-phone profile (CPU 4x slower, slow 4G: 150 ms round trip, 1.6 Mbps down) at 390 x 844, in French, as Direction on the demo workspace, staying 3 s on Home after sign-in before opening each other screen in turn. Timings are the app's own journeys and vitals, the same events real users send (ADR-0011): \`login.usable\` is the sign-in screen ready from a cold load, \`<screen>.ready\` is from navigation to settled data and a painted frame. Counts are API requests per screen. Ceilings may only go down (\`pnpm perf tighten\`); a raise is listed below with its reason.

Latest run: ${latest === undefined ? "none" : `${latest.at} on ${latest.commit}, ${latest.runs} runs each`}. Runs recorded: ${history.length}.

| Metric | First recorded | Previous | Today | Change since first | Best | Ceiling |
|---|---|---|---|---|---|---|
${rows.join("\n")}

## Ceilings raised

${raises.length === 0 ? "None." : raises.join("\n")}
`;
}
