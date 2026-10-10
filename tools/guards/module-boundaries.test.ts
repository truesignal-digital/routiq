import { describe, expect, it } from "vitest";
import { evaluate, readBaselines } from "./baseline.js";
import { importsOf, moduleBoundaryViolations, ownerOf, resolveSpecifier } from "./module-boundaries.js";
import { RULES } from "./rules.js";
import { repoFiles, type SourceFile } from "./scan.js";

const file = (path: string, content: string): SourceFile => ({ path: `apps/web/src/${path}`, content });

/** Two modules' manifests, the way `src/modules/<module>/manifest.ts` declares `uses`. */
const MANIFESTS = [
  file("modules/finance/manifest.ts", 'export const financeManifest = {\n  code: "FINANCE",\n  uses: ["ASSETS"],\n};'),
  file("modules/maintenance/manifest.ts", 'export const maintenanceManifest = {\n  code: "MAINTENANCE",\n  uses: [],\n};'),
];

const violations = (...files: SourceFile[]) =>
  moduleBoundaryViolations([...MANIFESTS, ...files]).map((v) => `${v.path.replace("apps/web/src/", "")}:${v.line} ${v.text}`);

describe("who owns a path", () => {
  it("splits the web app into core, modules and composition", () => {
    expect(ownerOf("apps/web/src/shell/sections.ts")).toEqual({ kind: "core" });
    expect(ownerOf("apps/web/src/vehicle/VehicleTabsNav.tsx")).toEqual({ kind: "core" });
    expect(ownerOf("apps/web/src/vehicle/tabs/MoneyTab.tsx")).toEqual({ kind: "module", code: "FINANCE" });
    expect(ownerOf("apps/web/src/screens/MaintenanceScreen")).toEqual({ kind: "module", code: "MAINTENANCE" });
    expect(ownerOf("apps/web/src/modules/activities/manifest.ts")).toEqual({ kind: "module", code: "ACTIVITIES" });
    expect(ownerOf("apps/web/src/modules/manifest.ts")).toEqual({ kind: "core" });
    expect(ownerOf("apps/web/src/modules/index.ts")).toEqual({ kind: "composition" });
    expect(ownerOf("apps/web/src/router")).toEqual({ kind: "composition" });
    expect(ownerOf("apps/api/src/server.ts")).toBeUndefined();
  });

  it("resolves relative and @/ specifiers, and leaves packages alone", () => {
    expect(resolveSpecifier("apps/web/src/shell/x.ts", "../finance/permissions.js")).toBe("apps/web/src/finance/permissions");
    expect(resolveSpecifier("apps/web/src/shell/x.ts", "./sections.js")).toBe("apps/web/src/shell/sections");
    expect(resolveSpecifier("apps/web/src/shell/x.ts", "@/maintenance/status.js")).toBe("apps/web/src/maintenance/status");
    expect(resolveSpecifier("apps/web/src/shell/x.ts", "@routiq/contracts")).toBeUndefined();
    // A directory import names the folder's index file.
    expect(resolveSpecifier("apps/web/src/shell/x.ts", "@/maintenance/index.js")).toBe("apps/web/src/maintenance");
    expect(ownerOf("apps/web/src/maintenance")).toEqual({ kind: "module", code: "MAINTENANCE" });
    expect(ownerOf("apps/web/src/modules/finance")).toEqual({ kind: "module", code: "FINANCE" });
    expect(ownerOf("apps/web/src/vehicle")).toEqual({ kind: "core" });
  });

  it("reads every kind of import, one per line that names it", () => {
    const edges = importsOf(
      file(
        "shell/x.ts",
        [
          'import { a } from "./a.js";',
          'import type { B } from "./b.js";',
          'import "./c.js";',
          "import {",
          "  d,",
          '} from "./d.js";',
          'export { e } from "./e.js";',
          'export * from "./f.js";',
          'const g = () => import("./g.js");',
        ].join("\n"),
      ),
    );
    expect(edges.map((edge) => [edge.line, edge.specifier])).toEqual([
      [1, "./a.js"],
      [2, "./b.js"],
      [3, "./c.js"],
      [6, "./d.js"],
      [7, "./e.js"],
      [8, "./f.js"],
      [9, "./g.js"],
    ]);
  });
});

describe("allowed edges", () => {
  it("lets composition wire every module into core", () => {
    expect(
      violations(
        file("modules/index.ts", 'import { financeManifest } from "./finance/manifest.js";\nimport { installModules } from "./manifest.js";'),
        file("router.tsx", 'const S = lazyScreen(() => import("./screens/MaintenanceScreen.js"), "MaintenanceScreen");'),
      ),
    ).toEqual([]);
  });

  it("lets a module import core, itself, and the modules it declares", () => {
    expect(
      violations(
        file("finance/RecordEntryForm.tsx", 'import { useMeContext } from "@/auth/me.js";\nimport { model } from "./model.js";\nimport { useAssetOptions } from "../assets/useAssetOptions.js";'),
        file("vehicle/tabs/MoneyTab.tsx", 'import { TabAction } from "./TabAction.js";\nimport { canReadFinance } from "@/finance/permissions.js";'),
      ),
    ).toEqual([]);
  });

  it("ignores tests, which may import anything", () => {
    expect(violations(file("shell/sections.test.ts", 'import { financeManifest } from "../modules/finance/manifest.js";'))).toEqual([]);
  });
});

describe("rejected edges", () => {
  it("rejects core importing a module, however it imports", () => {
    expect(
      violations(
        file(
          "shell/x.ts",
          [
            'import { canReadFinance } from "../finance/permissions.js";',
            'import type { WorkOrderRow } from "@/maintenance/columns.js";',
            'import "../activities/register.js";',
            'const lazy = () => import("../screens/MaintenanceScreen.js");',
          ].join("\n"),
        ),
      ),
    ).toEqual([
      'shell/x.ts:1 core → FINANCE: import { canReadFinance } from "../finance/permissions.js";',
      'shell/x.ts:2 core → MAINTENANCE: import type { WorkOrderRow } from "@/maintenance/columns.js";',
      'shell/x.ts:3 core → ACTIVITIES: import "../activities/register.js";',
      'shell/x.ts:4 core → MAINTENANCE: const lazy = () => import("../screens/MaintenanceScreen.js");',
    ]);
  });

  it("rejects a core barrel that re-exports a module, where the barrel is", () => {
    expect(
      violations(
        file("lib/everything.ts", 'export { useWorkOrders } from "../maintenance/useMaintenance.js";\nexport * from "../finance/model.js";'),
        file("shell/y.ts", 'import { useWorkOrders } from "../lib/everything.js";'),
      ),
    ).toEqual([
      'lib/everything.ts:1 core → MAINTENANCE: export { useWorkOrders } from "../maintenance/useMaintenance.js";',
      'lib/everything.ts:2 core → FINANCE: export * from "../finance/model.js";',
    ]);
  });

  it("rejects core importing a module through its folder's barrel", () => {
    expect(
      violations(
        file("maintenance/index.ts", 'export * from "./useMaintenance.js";'),
        file(
          "shell/sections.ts",
          [
            'import { useWorkOrders } from "@/maintenance";',
            'import { x } from "../finance";',
            'import { y } from "@/maintenance/index.js";',
            'import { z } from "../vehicle";',
          ].join("\n"),
        ),
      ),
    ).toEqual([
      'shell/sections.ts:1 core → MAINTENANCE: import { useWorkOrders } from "@/maintenance";',
      'shell/sections.ts:2 core → FINANCE: import { x } from "../finance";',
      'shell/sections.ts:3 core → MAINTENANCE: import { y } from "@/maintenance/index.js";',
    ]);
  });

  it("rejects a module importing a module it does not declare", () => {
    expect(
      violations(file("maintenance/close-cost.ts", 'import { EntryStatusBadge } from "@/finance/EntryStatusBadge.js";')),
    ).toEqual(['maintenance/close-cost.ts:1 MAINTENANCE (undeclared) → FINANCE: import { EntryStatusBadge } from "@/finance/EntryStatusBadge.js";']);
  });
});

describe("the repository", () => {
  it("adds no edge past B1's baseline, and the baseline only names core files", () => {
    const rule = RULES.find((candidate) => candidate.id === "B1");
    if (rule === undefined) throw new Error("no rule B1");
    const baseline = readBaselines()["B1"] ?? {};
    expect(evaluate(rule, repoFiles(), baseline).added).toEqual([]);
    // Every module-to-module edge is declared: what is left is core reaching into a module.
    expect(Object.keys(baseline).filter((path) => ownerOf(path)?.kind !== "core")).toEqual([]);
  });
});
