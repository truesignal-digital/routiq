import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * A PR that changes app code must show it working: a walkthrough video link,
 * or an explicit "Walkthrough video: not recorded (reason)" line for changes
 * with no visible effect, plus a "Found while testing" list (or "none").
 * Self-contained so CI runs the base branch's copy: a PR cannot relax the
 * check that judges it.
 */
export function changesBehaviour(files: readonly string[]): boolean {
  return files.some((path) => {
    if (!/^apps\/(web|api)\/src\//.test(path)) return false;
    if (/\.(json|md|snap)$/.test(path)) return false;
    if (/snapshots?(__)?\//.test(path) || /(^|\/)fixtures\//.test(path)) return false;
    if (/\.test\.tsx?$/.test(path) || /(^|\/)test-setup\.ts$/.test(path)) return false;
    return !path.startsWith("apps/api/src/test/");
  });
}

function withoutComments(body: string): string {
  return body.replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
}

/** The text under a `## Title` heading, without HTML comments. */
export function section(body: string, title: string): string | undefined {
  const lines = withoutComments(body).split("\n");
  const start = lines.findIndex((line) => new RegExp(`^#{2,3}\\s+${title}\\s*$`, "i").test(line.trim()));
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,3}\s/.test(line.trim()));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

/** The text after an inline `Title:` line anywhere in the body, e.g. "Found while testing: none". */
function inline(body: string, title: string): string | undefined {
  const match = new RegExp(`^\\s*(?:[-*]\\s+)?\\**${title}\\**:\\**\\s*(.*)$`, "im").exec(withoutComments(body));
  return match?.[1]?.trim();
}

/** "not recorded" followed by a reason: "(tooling only)", ", because ...", ". The change ...", ": ..." */
const NOT_RECORDED = /^not recorded\s*(?:\(\s*[^)\s][^)]*\)|[,.:;—–-]\s*\S)/i;

function hasVideo(body: string): boolean {
  const video = section(body, "Walkthrough video");
  if (video !== undefined && (/https:\/\/\S+/.test(video) || NOT_RECORDED.test(video))) return true;
  const line = inline(body, "Walkthrough video");
  if (line !== undefined && (/https:\/\/\S+/.test(line) || NOT_RECORDED.test(line))) return true;
  return false;
}

function hasFindings(body: string): boolean {
  const found = section(body, "Found while testing");
  if (found !== undefined && found !== "") return true;
  const line = inline(body, "Found while testing");
  return line !== undefined && line !== "";
}

export function evidenceProblems(body: string, files: readonly string[]): string[] {
  if (!changesBehaviour(files)) return [];
  const problems: string[] = [];
  if (!hasVideo(body)) {
    problems.push(
      'Walkthrough video: link a recording of the change working in the app (English UI and captions) under a `## Walkthrough video` heading, or, when nothing visible changed, write "Walkthrough video: not recorded (<reason>)".',
    );
  }
  if (!hasFindings(body)) {
    problems.push(
      'Found while testing: list the issues you filed for anything else that looked wrong, or write "none", under a `## Found while testing` heading.',
    );
  }
  return problems;
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
  const files = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" })
    .split("\n")
    .filter((path) => path !== "");
  const problems = evidenceProblems(process.env.PR_BODY ?? "", files);
  if (problems.length > 0) {
    console.error(`This PR changes app code, so its description needs:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log(changesBehaviour(files) ? "Walkthrough evidence present." : "No app code changed; no walkthrough needed.");
}
