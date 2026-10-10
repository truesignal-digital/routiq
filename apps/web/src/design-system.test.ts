import { readdirSync, readFileSync } from "fs";
import { extname, join, relative, resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * Design rules from docs/design/consistency/README.md ("Visual rules") that a
 * machine can check. Each guard names the rule it holds; weakening one needs
 * the same review as changing the rule. Colour-token discipline lives next
 * door in palette.test.ts.
 */
const SRC = resolve(__dirname);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (![".ts", ".tsx"].includes(extname(entry.name))) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

function offenders(pattern: RegExp, allow: (file: string) => boolean = () => false) {
  return sourceFiles(SRC).flatMap((path) => {
    const file = relative(SRC, path);
    if (allow(file)) return [];
    return readFileSync(path, "utf-8")
      .split("\n")
      .flatMap((line, index) => {
        const match = pattern.exec(line);
        return match === null ? [] : [`${file}:${index + 1} — ${match[0]}`];
      });
  });
}

describe("design system guards", () => {
  it("DS-3: the product is drawn by the brand component, not an icon standing in for it", () => {
    const sidebar = readFileSync(join(SRC, "shell/AppSidebar.tsx"), "utf-8");
    // The sidebar's logo row, shared with the shell's loading frame (#495).
    const brand = readFileSync(join(SRC, "shell/SidebarBrand.tsx"), "utf-8");
    const login = readFileSync(join(SRC, "screens/LoginScreen.tsx"), "utf-8");
    for (const file of [sidebar, brand]) expect(file).not.toMatch(/import\s*{[^}]*\bTruck\b[^}]*}\s*from\s*"lucide-react"/);
    expect(sidebar).toMatch(/<SidebarBrand\b/);
    expect(brand).toMatch(/<RoutiqLogo\b/);
    expect(login).toMatch(/<RoutiqLogo\b/);
  });

  it("DS-3: the brand token paints the ROUTIQ mark and nothing else", () => {
    const inBrand = (file: string) => file.startsWith(join("components", "brand") + "/");
    expect(offenders(/\b[\w:-]*-brand\b|var\(--brand\)/, inBrand)).toEqual([]);
  });
});
