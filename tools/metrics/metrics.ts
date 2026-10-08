import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/**
 * Numbers that may only go down. Each has a ceiling in ceilings.json; CI fails
 * above it, and fails below it until `pnpm metrics tighten` locks the gain in.
 * Raising a ceiling is a deliberate, reviewed act: `pnpm metrics raise` records
 * the reason in the file, so the owner sees it in the PR diff.
 */
export const METRICS = {
  "web.initial-js-gzip": "JavaScript the first page load downloads (entry + modulepreload), gzip bytes",
  "web.initial-css-gzip": "CSS the first page load downloads, gzip bytes",
  "web.all-js-gzip": "every JavaScript chunk the build emits, gzip bytes",
} as const;

export type MetricId = keyof typeof METRICS;
export type Values = Record<MetricId, number>;

export interface Raise {
  date: string;
  from: number;
  to: number;
  reason: string;
}

export type Ceilings = Partial<Record<MetricId, { ceiling: number; raises?: Raise[] }>>;

const CEILINGS_PATH = fileURLToPath(new URL("./ceilings.json", import.meta.url));

export function readCeilings(file: string = CEILINGS_PATH): Ceilings {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Ceilings) : {};
}

export function writeCeilings(ceilings: Ceilings, file: string = CEILINGS_PATH): void {
  const sorted = Object.fromEntries(Object.entries(ceilings).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
}

const gzipBytes = (file: string) => gzipSync(readFileSync(file), { level: 9 }).length;

/** Asset paths index.html loads up front, as files under dist. */
export function initialAssets(indexHtml: string): { js: string[]; css: string[] } {
  const js = [...indexHtml.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g), ...indexHtml.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)];
  const css = [...indexHtml.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)];
  const local = (matches: RegExpMatchArray[]) => [...new Set(matches.map((m) => m[1] ?? "").filter((href) => href.startsWith("/")))];
  return { js: local(js), css: local(css) };
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

export function measureWebBuild(dist: string): Values {
  const indexFile = path.join(dist, "index.html");
  if (!existsSync(indexFile)) throw new Error(`${indexFile} not found; build first: pnpm --filter @routiq/web build`);
  const { js, css } = initialAssets(readFileSync(indexFile, "utf8"));
  if (js.length === 0) throw new Error(`${indexFile} loads no module script; the parser in tools/metrics/metrics.ts needs updating`);
  const sum = (files: string[]) => files.reduce((total, file) => total + gzipBytes(file), 0);
  return {
    "web.initial-js-gzip": sum(js.map((href) => path.join(dist, href))),
    "web.initial-css-gzip": sum(css.map((href) => path.join(dist, href))),
    "web.all-js-gzip": sum(listFiles(dist).filter((file) => file.endsWith(".js"))),
  };
}

/**
 * The build bakes the commit hash in, so gzip size moves by a few bytes from
 * commit to commit with no code change. Inside this band a build is at its
 * ceiling; a real change is far larger (1 kB is about 5 ms on a pilot phone).
 */
export const NOISE_BYTES = 64;

/** A drop this large asks for `pnpm metrics tighten`; smaller ones are left until the next tighten. */
export const TIGHTEN_BYTES = 1024;

export type Verdict =
  | { id: MetricId; status: "unset"; value: number }
  | { id: MetricId; status: "ok"; value: number; ceiling: number }
  | { id: MetricId; status: "over"; value: number; ceiling: number }
  | { id: MetricId; status: "stale"; value: number; ceiling: number };

export function judge(values: Values, ceilings: Ceilings): Verdict[] {
  return (Object.keys(METRICS) as MetricId[]).map((id) => {
    const value = values[id];
    const ceiling = ceilings[id]?.ceiling;
    if (ceiling === undefined) return { id, status: "unset", value };
    if (value > ceiling + NOISE_BYTES) return { id, status: "over", value, ceiling };
    if (value < ceiling - TIGHTEN_BYTES) return { id, status: "stale", value, ceiling };
    return { id, status: "ok", value, ceiling };
  });
}

/** Lowers every ceiling to its value and sets missing ones; never raises. */
export function tighten(values: Values, ceilings: Ceilings): Ceilings {
  const next: Ceilings = { ...ceilings };
  for (const id of Object.keys(METRICS) as MetricId[]) {
    const current = ceilings[id];
    if (current === undefined) next[id] = { ceiling: values[id] };
    else if (values[id] < current.ceiling) next[id] = { ...current, ceiling: values[id] };
  }
  return next;
}

/**
 * Ceilings above the base branch's with no matching raise record: someone
 * edited ceilings.json by hand instead of running `pnpm metrics raise`.
 */
export function handRaised(current: Ceilings, base: Ceilings): MetricId[] {
  return (Object.keys(METRICS) as MetricId[]).filter((id) => {
    const now = current[id];
    const before = base[id];
    if (now === undefined || before === undefined || now.ceiling <= before.ceiling) return false;
    return !(now.raises ?? []).some((r) => r.from === before.ceiling && r.to === now.ceiling);
  });
}

export function raise(values: Values, ceilings: Ceilings, id: MetricId, reason: string, date: string): Ceilings {
  if (reason.trim().length < 15) throw new Error("--reason must say why the growth is worth it (15 characters or more)");
  const current = ceilings[id];
  if (current === undefined) throw new Error(`${id} has no ceiling yet; run pnpm metrics tighten`);
  if (values[id] <= current.ceiling + NOISE_BYTES) throw new Error(`${id} is ${values[id]}, within its ceiling ${current.ceiling} (+${NOISE_BYTES} B noise); nothing to raise`);
  const entry: Raise = { date, from: current.ceiling, to: values[id], reason: reason.trim() };
  return { ...ceilings, [id]: { ceiling: values[id], raises: [...(current.raises ?? []), entry] } };
}
