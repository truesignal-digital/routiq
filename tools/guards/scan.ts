import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export interface SourceFile {
  path: string;
  content: string;
}

export interface Violation {
  path: string;
  line: number;
  text: string;
}

const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yaml", ".yml", ".css"]);

/** Tracked files plus untracked ones git would not ignore, so a new file is guarded before it is committed. */
export function repoFiles(root: string = REPO_ROOT): SourceFile[] {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter((path) => path !== "");
  return [...new Set(listed)].flatMap((path) => {
    const absolute = resolve(root, path);
    // Deleted-but-tracked files and symlinked skill folders are not files to scan.
    const isFile = statSync(absolute, { throwIfNoEntry: false })?.isFile() ?? false;
    if (!isFile) return [];
    return [{ path, content: TEXT_EXTENSIONS.has(extname(path)) ? readFileSync(absolute, "utf8") : "" }];
  });
}

export function isTestFile(path: string): boolean {
  return /\.test\.tsx?$/.test(path) || /(^|\/)test-setup\.ts$/.test(path);
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("{/*")
  );
}

/** One violation per matching line; whole-line comments never count, so a rule can be documented in the code it guards. */
export function matchLines(file: SourceFile, pattern: RegExp): Violation[] {
  const flags = pattern.flags.replace("g", "");
  const once = new RegExp(pattern.source, flags);
  return file.content.split("\n").flatMap((text, index) =>
    !isCommentLine(text) && once.test(text)
      ? [{ path: file.path, line: index + 1, text: text.trim() }]
      : [],
  );
}

/** For patterns that span lines, such as a JSX element whose props wrap. */
export function matchFile(file: SourceFile, pattern: RegExp): Violation[] {
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  return [...file.content.matchAll(global)].map((match) => {
    const line = file.content.slice(0, match.index).split("\n").length;
    return {
      path: file.path,
      line,
      text: (file.content.split("\n")[line - 1] ?? "").trim(),
    };
  });
}

export function countByFile(violations: readonly Violation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { path } of violations) counts[path] = (counts[path] ?? 0) + 1;
  return counts;
}
