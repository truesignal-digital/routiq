import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Quality may only go up. A PR must not raise a guard baseline, drop a rule,
 * rewrite the guard machinery or add files to the legacy .scratch/ tracker,
 * unless a commit carries `Trust-Exception: ADR-NNNN` and that ADR exists.
 * Self-contained so CI runs the base branch's copy: a PR cannot relax the
 * check that judges it.
 */
export type Baselines = Record<string, Record<string, number>>;

/** Files whose lines may be added to freely but not removed or rewritten without an exception. */
export const PROTECTED = [
  ".claude/hooks/git-guardrails.ts",
  ".githooks/pre-push",
  ".github/workflows/pr-checks.yml",
  "tools/guards/baseline.ts",
  "tools/guards/guards.test.ts",
  "tools/guards/rules.test.ts",
  "tools/guards/rules.ts",
  "tools/guards/scan.ts",
  "tools/pr-evidence.ts",
  "tools/ratchet.ts",
];

export interface RatchetInput {
  base: Baselines | undefined;
  head: Baselines;
  baseRuleIds: readonly string[];
  headRuleIds: readonly string[];
  /** Protected files with removed or rewritten lines. */
  rewritten: readonly string[];
  scratchAdded: readonly string[];
  /** A cited ADR that exists, e.g. "ADR-0007". */
  exception: string | undefined;
}

export function ratchet(input: RatchetInput): { blocking: string[]; excused: string[] } {
  const weakened: string[] = [];
  if (input.base !== undefined) {
    for (const [id, files] of Object.entries(input.head)) {
      for (const [path, count] of Object.entries(files)) {
        const before = input.base[id]?.[path] ?? 0;
        if (count > before) weakened.push(`baseline raised: [${id}] ${path} ${before} → ${count}`);
      }
    }
  }
  for (const id of input.baseRuleIds) {
    if (!input.headRuleIds.includes(id)) weakened.push(`rule removed: ${id}`);
  }
  for (const path of input.rewritten) weakened.push(`guard machinery rewritten: ${path}`);
  const scratch = input.scratchAdded.map((path) => `new file in the legacy tracker (use a GitHub issue): ${path}`);
  return input.exception === undefined
    ? { blocking: [...weakened, ...scratch], excused: [] }
    : { blocking: scratch, excused: weakened };
}

function git(args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
}

function ruleIds(source: string | undefined): string[] {
  return source === undefined ? [] : [...source.matchAll(/\bid:\s*"([^"]+)"/g)].flatMap((m) => (m[1] ? [m[1]] : []));
}

function citedException(log: string): string | undefined {
  const match = /^Trust-Exception:\s*ADR-(\d{4})\b/m.exec(log);
  const number = match?.[1];
  if (number === undefined || !existsSync("docs/adr")) return undefined;
  return readdirSync("docs/adr").some((name) => name.startsWith(`${number}-`)) ? `ADR-${number}` : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const base = `origin/${process.env.BASE_REF ?? "develop"}`;
  const baseBaselines = git(["show", `${base}:tools/guards/baselines.json`]);
  const rewritten = PROTECTED.filter((path) => {
    const stat = git(["diff", "--numstat", `${base}...HEAD`, "--", path]) ?? "";
    const removed = Number(stat.split("\t")[1] ?? "0");
    return removed > 0;
  });
  const result = ratchet({
    base: baseBaselines === undefined ? undefined : (JSON.parse(baseBaselines) as Baselines),
    head: existsSync("tools/guards/baselines.json")
      ? (JSON.parse(readFileSync("tools/guards/baselines.json", "utf8")) as Baselines)
      : {},
    baseRuleIds: ruleIds(git(["show", `${base}:tools/guards/rules.ts`])),
    headRuleIds: ruleIds(existsSync("tools/guards/rules.ts") ? readFileSync("tools/guards/rules.ts", "utf8") : undefined),
    rewritten,
    scratchAdded: (git(["diff", "--name-only", "--diff-filter=A", `${base}...HEAD`, "--", ".scratch"]) ?? "")
      .split("\n")
      .filter((path) => path !== ""),
    exception: citedException(git(["log", "--format=%B", `${base}..HEAD`]) ?? ""),
  });
  for (const line of result.excused) console.log(`Allowed by Trust-Exception: ${line}`);
  if (result.blocking.length > 0) {
    console.error(
      `This PR weakens the guards:\n- ${result.blocking.join("\n- ")}\n` +
        "Fix the code instead. If the rule itself is wrong, record why in an ADR under docs/adr/ and add a " +
        "`Trust-Exception: ADR-NNNN` trailer to a commit.",
    );
    process.exit(1);
  }
  console.log("Ratchet holds: no baseline raised, no rule removed, guard machinery intact.");
}
