import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Quality may only go up. A PR must not raise a guard baseline, drop a rule,
 * rewrite the guard machinery or add files to the legacy .scratch/ tracker,
 * unless a commit carries `Trust-Exception: ADR-NNNN` and that ADR exists.
 * Size and speed ceilings (tools/metrics, tools/perf) may go up, but only with
 * the raise record their CLIs write; `pnpm metrics raise` and `pnpm perf raise`
 * are routine and pass.
 * Self-contained so CI runs the base branch's copy: a PR cannot relax the
 * check that judges it.
 */
export type Baselines = Record<string, Record<string, number>>;
export type Ceilings = Record<string, { ceiling: number; raises?: { from: number; to: number; reason: string }[] }>;

/** Files whose lines may be added to freely but not removed or rewritten without an exception. */
export const PROTECTED = [
  ".claude/hooks/git-guardrails.ts",
  ".githooks/pre-push",
  ".github/workflows/pr-checks.yml",
  "tools/guards/baseline.ts",
  "tools/guards/guards.test.ts",
  "tools/guards/report.ts",
  "tools/guards/rules.test.ts",
  "tools/guards/rules.ts",
  "tools/guards/scan.ts",
  "tools/guards/tighten.ts",
  "tools/pr-evidence.ts",
  "tools/ratchet.ts",
];

export const CEILING_FILES = ["tools/metrics/ceilings.json", "tools/perf/ceilings.json"];

export interface RatchetInput {
  base: Baselines | undefined;
  head: Baselines;
  baseRuleIds: readonly string[];
  headRuleIds: readonly string[];
  /** Protected files with removed or rewritten lines. */
  rewritten: readonly string[];
  scratchAdded: readonly string[];
  /** Ceiling files by path, as on the base branch and at the PR head. */
  ceilings: readonly { path: string; base: Ceilings | undefined; head: Ceilings }[];
  /** A cited ADR that exists, e.g. "ADR-0007". */
  exception: string | undefined;
}

/** Ceilings that went up without a new raise record ending at the new value. */
export function handRaisedCeilings(path: string, base: Ceilings | undefined, head: Ceilings): string[] {
  if (base === undefined) return [];
  return Object.entries(head).flatMap(([id, now]) => {
    const before = base[id];
    if (before === undefined || now.ceiling <= before.ceiling) return [];
    const added = (now.raises ?? []).slice((before.raises ?? []).length);
    const recorded = added.length > 0 && added.at(-1)?.to === now.ceiling && added.every((r) => r.reason.trim() !== "");
    return recorded ? [] : [`ceiling raised without a raise record: ${path} ${id} ${before.ceiling} → ${now.ceiling}`];
  });
}

export function ratchet(input: RatchetInput): { blocking: string[]; excused: string[] } {
  const weakened: string[] = [];
  if (input.base !== undefined) {
    for (const [id, files] of Object.entries(input.head)) {
      // A rule new in this PR starts from its grandfathered counts (`pnpm lint:tighten`).
      if (input.base[id] === undefined && !input.baseRuleIds.includes(id)) continue;
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
  for (const file of input.ceilings) weakened.push(...handRaisedCeilings(file.path, file.base, file.head));
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

function json<T>(text: string | undefined): T | undefined {
  return text === undefined ? undefined : (JSON.parse(text) as T);
}

function headFile(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

export function ruleIds(source: string | undefined): string[] {
  return source === undefined ? [] : [...source.matchAll(/\bid:\s*"([^"]+)"/g)].flatMap((m) => (m[1] ? [m[1]] : []));
}

export function citedException(log: string, adrFiles: readonly string[]): string | undefined {
  const number = /^Trust-Exception:\s*ADR-(\d{4})\b/m.exec(log)?.[1];
  if (number === undefined) return undefined;
  return adrFiles.some((name) => name.startsWith(`${number}-`)) ? `ADR-${number}` : undefined;
}

/** True when node runs this file directly (resolving symlinks such as macOS /tmp), not when a test imports it. */
function isMain(): boolean {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? "")).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  const base = `origin/${process.env.BASE_REF ?? "develop"}`;
  const rewritten = PROTECTED.filter((path) => {
    const stat = git(["diff", "--numstat", `${base}...HEAD`, "--", path]) ?? "";
    return stat.split("\n").some((line) => Number(line.split("\t")[1] ?? "0") > 0);
  });
  const result = ratchet({
    base: json<Baselines>(git(["show", `${base}:tools/guards/baselines.json`])),
    head: json<Baselines>(headFile("tools/guards/baselines.json")) ?? {},
    baseRuleIds: ruleIds(git(["show", `${base}:tools/guards/rules.ts`])),
    headRuleIds: ruleIds(headFile("tools/guards/rules.ts")),
    rewritten,
    scratchAdded: (git(["diff", "--name-only", "--diff-filter=A", `${base}...HEAD`, "--", ".scratch"]) ?? "")
      .split("\n")
      .filter((path) => path !== ""),
    ceilings: CEILING_FILES.map((path) => ({
      path,
      base: json<Ceilings>(git(["show", `${base}:${path}`])),
      head: json<Ceilings>(headFile(path)) ?? {},
    })),
    exception: citedException(git(["log", "--format=%B", `${base}..HEAD`]) ?? "", existsSync("docs/adr") ? readdirSync("docs/adr") : []),
  });
  for (const line of result.excused) console.log(`Allowed by Trust-Exception: ${line}`);
  if (result.blocking.length > 0) {
    console.error(
      `This PR weakens the guards:\n- ${result.blocking.join("\n- ")}\n` +
        "Fix the code instead. A size or speed ceiling goes up only through `pnpm metrics raise` or `pnpm perf raise` " +
        "with a reason. If a guard rule itself is wrong, record why in an ADR under docs/adr/ and add a " +
        "`Trust-Exception: ADR-NNNN` trailer to a commit.",
    );
    process.exit(1);
  }
  console.log("Ratchet holds: no baseline raised, no rule removed, guard machinery intact, every ceiling raise recorded.");
}
