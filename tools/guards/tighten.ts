import { evaluate, readBaselines, writeBaselines, type Baselines } from "./baseline.js";
import { RULES } from "./rules.js";
import { repoFiles } from "./scan.js";

/**
 * Lowers baselines to the current counts. It never raises one: a count above
 * its baseline is a new violation to fix, and raising a baseline by hand is a
 * Trust-Exception that needs an ADR.
 */
const files = repoFiles();
const baselines = readBaselines();
const next: Baselines = {};
const increases: string[] = [];
const lowered: string[] = [];

for (const rule of RULES) {
  const baseline = baselines[rule.id] ?? {};
  const { counts, added } = evaluate(rule, files, baseline);
  for (const v of added) increases.push(`[${rule.id}] ${v.path}:${v.line} — ${v.text}`);
  const kept: Record<string, number> = {};
  for (const [path, count] of Object.entries(baseline)) {
    const actual = Math.min(counts[path] ?? 0, count);
    if (actual < count) lowered.push(`[${rule.id}] ${path}: ${count} → ${actual}`);
    kept[path] = actual;
  }
  next[rule.id] = kept;
}

if (increases.length > 0) {
  console.error("Refusing to tighten while there are new violations. Fix these first:\n" + increases.join("\n"));
  process.exit(1);
}
writeBaselines(next);
console.log(lowered.length > 0 ? `Tightened:\n${lowered.join("\n")}` : "Baselines already tight.");
