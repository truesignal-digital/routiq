import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import fr from "../i18n/locales/fr.json";

const SRC = join(import.meta.dirname, "..");
const HOME = "maintenance/WorkOrderSheet.tsx";
const HEADING = 't("maintenance.detail.chronologie")';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

/** The names a file renders the component under: its own name at home, else whatever the import binds. */
function localNames(name: string, source: string): string[] {
  if (name === HOME) return ["Chronologie"];
  const names: string[] = [];
  for (const [, specifiers = ""] of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*\/WorkOrderSheet(?:\.js)?["']/g)) {
    for (const spec of specifiers.split(",")) {
      const match = /^\s*(?:type\s+)?Chronologie(?:\s+as\s+(\w+))?\s*$/.exec(spec);
      if (match) names.push(match[1] ?? "Chronologie");
    }
  }
  return names;
}

/** The last heading opened before `at`: an h1–h6 element's content or a `title=` prop. */
function headingBefore(source: string, at: number): string | undefined {
  const before = source.slice(0, at);
  const headings = [...before.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>|\btitle=(\{[^\n]*\}|"[^"]*")/g)];
  const last = headings.at(-1);
  return last?.[1] ?? last?.[2];
}

const renders = sourceFiles(SRC).flatMap((file) => {
  const name = file.slice(SRC.length + 1);
  const source = readFileSync(file, "utf8");
  return localNames(name, source).flatMap((local) =>
    [...source.matchAll(new RegExp(`<${local}[\\s/>]`, "g"))].map((m) => ({
      where: `${name}:${source.slice(0, m.index).split("\n").length}`,
      heading: headingBefore(source, m.index),
    })),
  );
});

describe("one heading for the chronologie (#404)", () => {
  it("finds the vehicle panels and the maintenance sheet at least", () => {
    const files = new Set(renders.map((r) => r.where.split(":")[0]));
    for (const known of [HOME, "vehicle/panel/IssueRecord.tsx", "vehicle/panel/WorkOrderRecord.tsx"]) {
      expect(files.has(known), known).toBe(true);
    }
  });

  it.each(renders.map((r) => [r.where, r.heading]))("%s heads it with the shared key", (_where, heading) => {
    expect(heading).toContain(HEADING);
  });

  it("keeps no second key for the same heading", () => {
    expect(en.vehicle.panel).not.toHaveProperty("chronology");
    expect(fr.vehicle.panel).not.toHaveProperty("chronology");
    expect(en.maintenance.detail.chronologie).toBe("Chronology");
    expect(fr.maintenance.detail.chronologie).toBe("Chronologie");
  });
});
