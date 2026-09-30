import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Rule } from "./rules.js";
import { countByFile, type SourceFile, type Violation } from "./scan.js";

/** rule id → file → number of known violations. Counts may only go down. */
export type Baselines = Record<string, Record<string, number>>;

const BASELINES_PATH = fileURLToPath(new URL("./baselines.json", import.meta.url));

export function readBaselines(): Baselines {
  return JSON.parse(readFileSync(BASELINES_PATH, "utf8")) as Baselines;
}

export function writeBaselines(baselines: Baselines): void {
  const sorted: Baselines = {};
  for (const id of Object.keys(baselines).sort()) {
    const files = baselines[id] ?? {};
    const entries = Object.entries(files)
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    if (entries.length > 0) sorted[id] = Object.fromEntries(entries);
  }
  writeFileSync(BASELINES_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
}

export interface Evaluation {
  counts: Record<string, number>;
  /** Files with more violations than their baseline, with every offending line. */
  added: Violation[];
  /** Files now below their baseline: the ratchet must be tightened to lock the gain in. */
  stale: { path: string; baseline: number; actual: number }[];
}

export function evaluate(
  rule: Rule,
  files: readonly SourceFile[],
  baseline: Record<string, number> = {},
): Evaluation {
  const violations = rule.check(files);
  const counts = countByFile(violations);
  const added = violations.filter(({ path }) => (counts[path] ?? 0) > (baseline[path] ?? 0));
  const stale = Object.entries(baseline)
    .filter(([path, count]) => (counts[path] ?? 0) < count)
    .map(([path, count]) => ({ path, baseline: count, actual: counts[path] ?? 0 }));
  return { counts, added, stale };
}
