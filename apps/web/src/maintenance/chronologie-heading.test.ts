import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import fr from "../i18n/locales/fr.json";

const SRC = join(import.meta.dirname, "..");
const HEADING_KEY = "maintenance.detail.chronologie";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

describe("one heading for the chronologie (#404)", () => {
  const surfaces = sourceFiles(SRC).filter((file) => readFileSync(file, "utf8").includes("<Chronologie "));

  it("finds the vehicle panels and the maintenance sheet", () => {
    const names = surfaces.map((file) => file.slice(SRC.length + 1)).sort();
    expect(names).toEqual([
      "maintenance/WorkOrderSheet.tsx",
      "vehicle/panel/IssueRecord.tsx",
      "vehicle/panel/WorkOrderRecord.tsx",
    ]);
  });

  it.each(surfaces.map((file) => [file.slice(SRC.length + 1), file]))(
    "%s heads it with the shared key",
    (_name, file) => {
      expect(readFileSync(file, "utf8")).toContain(`t("${HEADING_KEY}")`);
    },
  );

  it("keeps no second key for the same heading", () => {
    expect(en.vehicle.panel).not.toHaveProperty("chronology");
    expect(fr.vehicle.panel).not.toHaveProperty("chronology");
    expect(en.maintenance.detail.chronologie).toBe("Chronology");
    expect(fr.maintenance.detail.chronologie).toBe("Chronologie");
  });
});
