import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Claude Code PreToolUse hook for Bash. Agents push their own feature branches
 * and open PRs; everything that lands on a shared branch, rewrites history,
 * skips the pre-push checks or discards work stays with a human.
 */
const PROTECTED = new Set(["main", "develop"]);

function segments(command: string): string[][] {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map((segment) => segment.trim().split(/\s+/).filter((token) => token !== ""))
    .filter((tokens) => tokens.length > 0);
}

/** The git subcommand and its arguments, skipping global options such as `-C dir`. */
function gitCall(tokens: string[]): { cwd: string | undefined; sub: string; args: string[] } | undefined {
  const at = tokens.indexOf("git");
  if (at === -1) return undefined;
  let cwd: string | undefined;
  let i = at + 1;
  while (i < tokens.length && tokens[i]?.startsWith("-")) {
    if (tokens[i] === "-C") cwd = tokens[i + 1];
    i += tokens[i] === "-C" || tokens[i] === "-c" ? 2 : 1;
  }
  const sub = tokens[i];
  return sub === undefined ? undefined : { cwd, sub, args: tokens.slice(i + 1) };
}

function refTargets(arg: string): string {
  const target = arg.includes(":") ? (arg.split(":").pop() ?? "") : arg;
  return target.replace(/^\+/, "").replace(/^refs\/heads\//, "");
}

/** Returns why the command is blocked, or undefined when it may run. */
export function decide(command: string, currentBranch: (cwd: string | undefined) => string | undefined): string | undefined {
  for (const tokens of segments(command)) {
    if (tokens[0] === "gh" && tokens[1] === "pr" && tokens[2] === "merge") {
      return "Agents never merge PRs; the owner merges after watching the walkthrough video.";
    }
    const git = gitCall(tokens);
    if (git === undefined) continue;
    const { sub, args } = git;
    if (sub === "push") {
      if (args.some((a) => a === "--force" || a === "-f" || a.startsWith("--force-with-lease") || /^\+/.test(a))) {
        return "Force pushes rewrite shared history.";
      }
      if (args.includes("--no-verify")) return "--no-verify skips the pre-push typecheck and guards.";
      if (args.includes("--delete") || args.includes("-d") || args.some((a) => a.startsWith(":"))) {
        return "Deleting remote branches is for a human.";
      }
      const refspecs = args.filter((a) => !a.startsWith("-")).slice(1);
      if (refspecs.some((a) => PROTECTED.has(refTargets(a)))) {
        return "Changes reach main and develop only through a reviewed PR.";
      }
      if (refspecs.length === 0 && PROTECTED.has(currentBranch(git.cwd) ?? "")) {
        return "This checkout is on a protected branch; push a feature branch and open a PR.";
      }
    }
    if (sub === "reset" && args.includes("--hard")) return "reset --hard discards work.";
    if (sub === "clean" && args.some((a) => /^-[a-zA-Z]*f/.test(a))) return "clean -f deletes untracked files.";
    if (sub === "branch" && args.some((a) => a === "-D" || a === "--delete" && args.includes("--force"))) {
      return "branch -D deletes unmerged work.";
    }
    if ((sub === "checkout" || sub === "restore") && args.includes(".")) return `${sub} . discards local changes.`;
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const input = JSON.parse(readFileSync(0, "utf8")) as { cwd?: string; tool_input?: { command?: string } };
  const reason = decide(input.tool_input?.command ?? "", (cwd) => branchOf(cwd ?? input.cwd));
  if (reason !== undefined) {
    console.error(`BLOCKED by .claude/hooks/git-guardrails.ts: ${reason} Ask the owner if this is really needed.`);
    process.exit(2);
  }
}
