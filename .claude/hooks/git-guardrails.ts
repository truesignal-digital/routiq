import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Claude Code PreToolUse hook for Bash. Agents push their own feature branches,
 * open PRs and, when the owner asks, merge reviewed PRs into develop pinned to
 * the reviewed head. Everything that lands on main, rewrites history, skips the
 * pre-push checks or discards work stays with a human.
 *
 * Self-contained (node built-ins only) so `node` can run it straight from .ts.
 */
const PROTECTED = new Set(["main", "develop"]);
const MERGE_BASE = "develop";

export interface Segment {
  tokens: string[];
  /** Inline `NAME=value` assignments before the command. */
  env: Record<string, string>;
  /** Directory set by an earlier `cd` in the same command line. */
  cwd: string | undefined;
}

export interface Context {
  currentBranch: (cwd: string | undefined) => string | undefined;
  /** Base branch of the PR `gh pr view` resolves for these args, or undefined if it can't be determined. */
  prBase: (viewArgs: string[], env: Record<string, string>, cwd: string | undefined) => string | undefined;
}

/** Drops heredoc bodies so text written to files or PR bodies is not read as commands. */
function stripHeredocs(command: string): string {
  const lines = command.split("\n");
  const out: string[] = [];
  let terminator: string | undefined;
  let tabs = false;
  for (const line of lines) {
    if (terminator !== undefined) {
      if ((tabs ? line.replace(/^\t+/, "") : line) === terminator) terminator = undefined;
      continue;
    }
    out.push(line);
    const match = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(line);
    if (match?.[3] !== undefined) {
      terminator = match[3];
      tabs = match[1] === "-";
    }
  }
  return out.join("\n");
}

/** Splits a shell command line into simple commands, honouring quotes. */
export function segments(command: string): Segment[] {
  const source = stripHeredocs(command);
  const raw: string[][] = [];
  let tokens: string[] = [];
  let token = "";
  let inToken = false;
  const endToken = () => {
    if (inToken) tokens.push(token);
    token = "";
    inToken = false;
  };
  const endSegment = () => {
    endToken();
    if (tokens.length > 0) raw.push(tokens);
    tokens = [];
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i] as string;
    if (c === "'") {
      const close = source.indexOf("'", i + 1);
      const end = close === -1 ? source.length : close;
      token += source.slice(i + 1, end);
      inToken = true;
      i = end;
    } else if (c === '"') {
      inToken = true;
      i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "\\" && i + 1 < source.length) i++;
        token += source[i];
        i++;
      }
    } else if (c === "\\") {
      if (source[i + 1] !== "\n") {
        token += source[i + 1] ?? "";
        inToken = true;
      }
      i++;
    } else if (c === " " || c === "\t") {
      endToken();
    } else if (c === "\n" || c === ";" || c === "|" || c === "&" || c === "(" || c === ")") {
      endSegment();
    } else {
      token += c;
      inToken = true;
    }
  }
  endSegment();

  const result: Segment[] = [];
  let cwd: string | undefined;
  for (const words of raw) {
    const env: Record<string, string> = {};
    let start = 0;
    while (start < words.length) {
      const word = words[start] as string;
      const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(word);
      if (assignment?.[1] !== undefined) env[assignment[1]] = expandHome(assignment[2] ?? "");
      else if (word !== "env" && word !== "command" && word !== "time") break;
      start++;
    }
    const rest: string[] = [];
    for (let i = start; i < words.length; i++) {
      const word = words[i] as string;
      const redirect = /^\d*(<<-?|>>?|<)(.*)$/.exec(word);
      if (redirect === null) rest.push(word);
      else if (redirect[2] === "") i++;
    }
    if (rest[0] === "cd" && rest[1] !== undefined) {
      const target = expandHome(rest[1]);
      cwd = cwd === undefined ? target : resolve(cwd, target);
      continue;
    }
    if (rest.length > 0) result.push({ tokens: rest, env, cwd });
  }
  return result;
}

function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? homedir() + path.slice(1) : path;
}

/** The git subcommand and its arguments, skipping global options such as `-C dir`. */
function gitCall(tokens: string[]): { cwd: string | undefined; config: string[]; sub: string; args: string[] } | undefined {
  const at = tokens.indexOf("git");
  if (at === -1) return undefined;
  let cwd: string | undefined;
  const config: string[] = [];
  let i = at + 1;
  while (i < tokens.length && tokens[i]?.startsWith("-")) {
    const option = tokens[i] as string;
    if (option === "-C") cwd = tokens[i + 1];
    if (option === "-c") config.push(tokens[i + 1] ?? "");
    i += option === "-C" || option === "-c" ? 2 : 1;
  }
  const sub = tokens[i];
  return sub === undefined ? undefined : { cwd, config, sub, args: tokens.slice(i + 1) };
}

function refTarget(arg: string): string {
  const target = arg.includes(":") ? (arg.split(":").pop() ?? "") : arg;
  return target.replace(/^\+/, "").replace(/^refs\/heads\//, "");
}

/** Short-flag cluster such as `-fd` containing the letter. */
function hasShortFlag(args: string[], letter: string): boolean {
  return args.some((a) => /^-[a-zA-Z]+$/.test(a) && a.slice(1).includes(letter));
}

const PUSH_OPTIONS_WITH_VALUE = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);

function decidePush(args: string[], cwd: string | undefined, context: Context): string | undefined {
  if (args.some((a) => a === "--force" || a.startsWith("--force-with-lease") || a === "--mirror") || hasShortFlag(args, "f")) {
    return "Force pushes rewrite shared history.";
  }
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (PUSH_OPTIONS_WITH_VALUE.has(arg)) i++;
    else if (!arg.startsWith("-")) positional.push(arg);
  }
  const refspecs = positional.slice(1);
  if (refspecs.some((a) => a.startsWith("+"))) return "Force pushes rewrite shared history.";
  if (args.includes("--delete") || hasShortFlag(args, "d") || args.includes("--prune") || refspecs.some((a) => a.startsWith(":"))) {
    return "Deleting remote branches is for a human.";
  }
  if (args.includes("--all") || args.includes("--branches")) return "Pushing every branch can update main or develop; push one feature branch.";
  if (refspecs.some((a) => PROTECTED.has(refTarget(a)))) return "Changes reach main and develop only through a reviewed PR.";
  const branch = context.currentBranch(cwd);
  if ((refspecs.length === 0 || refspecs.some((a) => refTarget(a) === "HEAD")) && PROTECTED.has(branch ?? "")) {
    return "This checkout is on a protected branch; push a feature branch and open a PR.";
  }
  return undefined;
}

const MERGE_OPTIONS_WITH_VALUE = new Set([
  "--match-head-commit",
  "-b",
  "--body",
  "-F",
  "--body-file",
  "-t",
  "--subject",
  "-A",
  "--author-email",
  "-R",
  "--repo",
]);

function decidePrMerge(args: string[], segment: Segment, context: Context): string | undefined {
  if (args.includes("--admin")) return "gh pr merge --admin bypasses branch protection.";
  if (args.includes("--delete-branch") || hasShortFlag(args, "d")) {
    return "Deleting remote branches is for a human; merge without --delete-branch.";
  }
  const pinned = args.some((a, i) => (a === "--match-head-commit" && /^[0-9a-f]{7,40}$/i.test(args[i + 1] ?? "")) || /^--match-head-commit=[0-9a-f]{7,40}$/i.test(a));
  if (!pinned) return "gh pr merge needs --match-head-commit <reviewed head SHA> so only the reviewed commit lands.";
  let selector: string | undefined;
  const repo: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "-R" || arg === "--repo") repo.push(arg, args[i + 1] ?? "");
    if (arg.startsWith("--repo=")) repo.push(arg);
    if (MERGE_OPTIONS_WITH_VALUE.has(arg)) i++;
    else if (!arg.startsWith("-")) selector ??= arg;
  }
  const base = context.prBase([...(selector === undefined ? [] : [selector]), ...repo], segment.env, segment.cwd);
  if (base === undefined) {
    return "Could not read this PR's base branch with `gh pr view --json baseRefName`, so the merge is blocked. Check gh auth (GH_CONFIG_DIR) and the PR number.";
  }
  if (base === "main") return "Merges into main are releases and stay with the owner.";
  if (base !== MERGE_BASE) return `Agents merge only into ${MERGE_BASE}; this PR targets ${base}.`;
  return undefined;
}

function decideGhApi(args: string[]): string | undefined {
  const text = args.join(" ");
  if (/pulls\/[^/\s]+\/merge\b/.test(text) || /mergePullRequest/.test(text)) {
    return "Merge through `gh pr merge --match-head-commit <sha>` so the base and head checks apply.";
  }
  if (/git\/refs\/heads\//.test(text) && /(-X|--method)\s*DELETE/i.test(text)) return "Deleting remote branches is for a human.";
  return undefined;
}

/** Returns why the command is blocked, or undefined when it may run. */
export function decide(command: string, context: Context): string | undefined {
  for (const segment of segments(command)) {
    const { tokens } = segment;
    const gh = tokens.indexOf("gh");
    if (gh !== -1 && tokens[gh + 1] === "pr" && tokens[gh + 2] === "merge") {
      const reason = decidePrMerge(tokens.slice(gh + 3), segment, context);
      if (reason !== undefined) return reason;
      continue;
    }
    if (gh !== -1 && tokens[gh + 1] === "api") {
      const reason = decideGhApi(tokens.slice(gh + 2));
      if (reason !== undefined) return reason;
      continue;
    }
    const git = gitCall(tokens);
    if (git === undefined) continue;
    const { sub, args } = git;
    const cwd = git.cwd === undefined ? segment.cwd : resolve(segment.cwd ?? ".", git.cwd);
    if (args.includes("--no-verify")) return "--no-verify skips the pre-push typecheck and guards.";
    if (git.config.some((c) => /^core\.hooksPath=/i.test(c))) return "Overriding core.hooksPath skips the pre-push checks.";
    if (sub === "push") {
      const reason = decidePush(args, cwd, context);
      if (reason !== undefined) return reason;
    }
    if (sub === "reset" && args.includes("--hard")) return "reset --hard discards work.";
    if (sub === "clean" && (args.includes("--force") || hasShortFlag(args, "f"))) return "clean -f deletes untracked files.";
    if (sub === "branch") {
      const force = args.includes("--force") || hasShortFlag(args, "f");
      const del = args.includes("--delete") || hasShortFlag(args, "d");
      if (hasShortFlag(args, "D") || (del && force)) return "branch -D deletes unmerged work.";
    }
    if (sub === "checkout" && args.includes(".")) return "checkout . discards local changes.";
    if (sub === "restore" && args.includes(".")) {
      const onlyStaged = (args.includes("--staged") || hasShortFlag(args, "S")) && !args.includes("--worktree") && !hasShortFlag(args, "W");
      if (!onlyStaged) return "restore . discards local changes.";
    }
  }
  return undefined;
}

function branchOf(cwd: string | undefined): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: cwd ?? process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function baseOf(viewArgs: string[], env: Record<string, string>, cwd: string | undefined): string | undefined {
  try {
    const base = execFileSync("gh", ["pr", "view", ...viewArgs, "--json", "baseRefName", "--jq", ".baseRefName"], {
      cwd: cwd ?? process.cwd(),
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 20_000,
    }).trim();
    return base === "" ? undefined : base;
  } catch {
    return undefined;
  }
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
  const input = JSON.parse(readFileSync(0, "utf8")) as { cwd?: string; tool_input?: { command?: string } };
  const at = (cwd: string | undefined) => (cwd === undefined ? input.cwd : resolve(input.cwd ?? process.cwd(), cwd));
  const reason = decide(input.tool_input?.command ?? "", {
    currentBranch: (cwd) => branchOf(at(cwd)),
    prBase: (viewArgs, env, cwd) => baseOf(viewArgs, env, at(cwd)),
  });
  if (reason !== undefined) {
    console.error(`BLOCKED by .claude/hooks/git-guardrails.ts: ${reason} Ask the owner if this is really needed.`);
    process.exit(2);
  }
}
