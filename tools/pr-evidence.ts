import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * A feature PR is done only with a walkthrough video and a list of what else
 * looked wrong while testing (AGENTS.md, definition of done). Self-contained
 * so CI can run the base branch's copy against the PR.
 */
export function changesBehaviour(files: readonly string[]): boolean {
  return files.some(
    (path) =>
      /^apps\/(web|api)\/src\//.test(path) &&
      !/\.test\.tsx?$/.test(path) &&
      !/(^|\/)test-setup\.ts$/.test(path) &&
      !path.startsWith("apps/api/src/test/"),
  );
}

/** The text under a `## Title` heading, without HTML comments. */
export function section(body: string, title: string): string | undefined {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => new RegExp(`^#{2,3}\\s+${title}\\s*$`, "i").test(line.trim()));
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,3}\s/.test(line.trim()));
  return (end === -1 ? rest : rest.slice(0, end))
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

export function evidenceProblems(body: string, files: readonly string[]): string[] {
  if (!changesBehaviour(files)) return [];
  const problems: string[] = [];
  const video = section(body, "Walkthrough video");
  if (video === undefined || !/https:\/\/\S+/.test(video)) {
    problems.push(
      "Walkthrough video: link a recording of the feature working in the app (English UI and captions) under a `## Walkthrough video` heading.",
    );
  }
  const found = section(body, "Found while testing");
  if (found === undefined || found === "") {
    problems.push(
      "Found while testing: list the issues you filed for anything else that looked wrong, or write \"none\", under a `## Found while testing` heading.",
    );
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
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
