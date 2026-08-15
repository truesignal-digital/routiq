import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname);

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.name.endsWith(".test.tsx") ? [path] : [];
  });
}

/**
 * A guard rather than a behavioural test: the race it protects against only
 * shows up on a machine idle enough to lose it, so no assertion about a
 * rendered select can fail reliably when the wait is dropped. What can be
 * pinned is the idiom — keys sent on the line after the click reach a trigger
 * whose popup has not mounted yet, and the Enter commits nothing.
 */
describe("opening a select in tests", () => {
  it("never sends keys on the line after the click", () => {
    const offenders: string[] = [];

    for (const path of testFiles(SRC)) {
      const lines = readFileSync(path, "utf-8").split("\n");
      lines.forEach((line, index) => {
        const next = lines[index + 1] ?? "";
        if (/\buser\.click\(/.test(line) && /\buser\.keyboard\("\{Arrow/.test(next)) {
          offenders.push(`${relative(SRC, path)}:${index + 1}`);
        }
      });
    }

    expect(offenders, "use openSelect from test-select.ts instead").toEqual([]);
  });
});
