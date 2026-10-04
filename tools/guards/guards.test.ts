import { describe, expect, it } from "vitest";
import { evaluate, readBaselines } from "./baseline.js";
import { RULES } from "./rules.js";
import { JOURNAL } from "./migrations.js";
import { fileAtRef, repoFiles } from "./scan.js";

const files = [...repoFiles(), ...fileAtRef(process.env["GUARD_BASE_REF"] ?? "origin/develop", JOURNAL)];
const baselines = readBaselines();

describe.each(RULES)("[$id $name]", (rule) => {
  const result = evaluate(rule, files, baselines[rule.id]);

  it("adds no violations", () => {
    const report = result.added.map((v) => `${v.path}:${v.line} — ${v.text}`);
    expect(report, `[${rule.id} ${rule.name}] ${rule.fix}`).toEqual([]);
  });

  it("keeps its baseline tight", () => {
    const report = result.stale.map(
      (s) => `${s.path}: baseline ${s.baseline}, now ${s.actual} — run \`pnpm lint:tighten\` to lock the gain in`,
    );
    expect(report).toEqual([]);
  });
});

describe("baselines.json", () => {
  it("names only rules that exist", () => {
    const known = new Set(RULES.map((rule) => rule.id));
    expect(Object.keys(baselines).filter((id) => !known.has(id))).toEqual([]);
  });
});

