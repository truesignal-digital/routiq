import { readdirSync, readFileSync } from "fs";
import { extname, join, relative, resolve } from "path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname);

/**
 * Palette utilities name a colour; semantic tokens name a meaning. A hardcoded
 * shade is invisible to the theme, so the sweep that removed them stays swept.
 */
const HARDCODED_PALETTE =
  /\b(?:bg|text|border|ring|fill|stroke|from|via|to)-(?:emerald|amber|sky|blue|green|stone|red|slate|zinc|gray|neutral|orange|yellow|teal|cyan|indigo|violet|purple|pink|rose|lime)-\d{2,3}\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (![".ts", ".tsx", ".css"].includes(extname(entry.name))) return [];
    // This file quotes the very classes it bans.
    if (path === __filename) return [];
    return [path];
  });
}

describe("semantic colour tokens", () => {
  it("no source file reaches for a raw Tailwind palette shade", () => {
    const offenders = sourceFiles(SRC).flatMap((path) =>
      readFileSync(path, "utf-8")
        .split("\n")
        .flatMap((line, index) => {
          const match = HARDCODED_PALETTE.exec(line);
          return match === null
            ? []
            : [`${relative(SRC, path)}:${index + 1} — ${match[0]}`];
        }),
    );

    expect(offenders).toEqual([]);
  });
});
