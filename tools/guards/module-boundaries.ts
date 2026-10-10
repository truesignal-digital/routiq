import { isTestFile, type SourceFile, type Violation } from "./scan.js";

/**
 * Core never imports a module (AGENTS.md, "Core vs modules"; #330). In the web
 * app every file is one of three things:
 *
 * - a module's: the paths in MODULE_ROOTS. A module's manifest lives in
 *   `src/modules/<module>/`; its screens, tabs, panels and forms still sit in
 *   the feature folders they grew up in, listed here one by one.
 * - composition: the few files that know every module and wire them into
 *   core's slots (COMPOSITION). The router and the entry are here because
 *   they name every screen.
 * - core: everything else, including the vehicle record's frame (header, tab
 *   bar, action catalogue, record panel) that every module plugs into.
 *
 * Core may import core. A module may import core, itself, and the modules its
 * web manifest names in `uses`. Composition may import anything. Static,
 * dynamic, type-only and side-effect imports and re-exports all count, so a
 * core barrel that re-exports a module file is caught at the barrel.
 */

export type ModuleCode = "ASSETS" | "DOCUMENTS" | "FINANCE" | "ACTIVITIES" | "MAINTENANCE" | "SCHEDULING";

const WEB = "apps/web/src/";

/** Path prefixes under apps/web/src/, extension left off so a prefix can name one file. */
export const MODULE_ROOTS: Record<ModuleCode, readonly string[]> = {
  ASSETS: ["modules/assets/", "assets/", "screens/AssetRegisterScreen", "screens/AssetsStub", "vehicle/forms/CustodianField"],
  DOCUMENTS: ["modules/documents/", "documents/", "vehicle/tabs/DocumentsTab", "vehicle/panel/DocumentRecord"],
  FINANCE: [
    "modules/finance/",
    "finance/",
    "screens/Finance",
    "screens/CompanySettingsScreen",
    "vehicle/tabs/MoneyTab",
    "vehicle/panel/EntryRecord",
    "vehicle/forms/LogFuelForm",
  ],
  ACTIVITIES: [
    "modules/activities/",
    "activities/",
    "screens/Activit",
    "screens/PersonsScreen",
    "vehicle/tabs/TripsTab",
    "vehicle/panel/TripRecord",
    "vehicle/panel/ReadingsRecord",
  ],
  MAINTENANCE: [
    "modules/maintenance/",
    "maintenance/",
    "screens/MaintenanceScreen",
    "vehicle/tabs/MaintenanceTab",
    "vehicle/panel/WorkOrderRecord",
    "vehicle/panel/IssueRecord",
  ],
  SCHEDULING: ["modules/scheduling/", "scheduling/"],
};

/** The composition boundary: the only files that may import every module. */
export const COMPOSITION: readonly string[] = ["modules/index.ts", "modules/app-shell.ts", "router.tsx", "main.tsx"];

export type Owner = { kind: "core" } | { kind: "composition" } | { kind: "module"; code: ModuleCode };

/** Who owns a web source path (with or without its extension); undefined outside apps/web/src. */
export function ownerOf(path: string): Owner | undefined {
  if (!path.startsWith(WEB)) return undefined;
  const inner = path.slice(WEB.length);
  if (COMPOSITION.some((file) => inner === file || inner === file.replace(/\.tsx?$/, ""))) return { kind: "composition" };
  for (const [code, roots] of Object.entries(MODULE_ROOTS) as [ModuleCode, readonly string[]][]) {
    // A folder root also owns the folder itself: `@/maintenance` imports its index.
    if (roots.some((root) => inner.startsWith(root) || `${inner}/` === root)) return { kind: "module", code };
  }
  return { kind: "core" };
}

export interface ImportEdge {
  line: number;
  text: string;
  specifier: string;
}

const IMPORT_PATTERNS = [
  /^\s*import\s+(?:type\s+)?[^;'"]*?\sfrom\s+["']([^"']+)["']/gm,
  /^\s*import\s+["']([^"']+)["']/gm,
  /^\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*(?:as\s+\w+\s+)?from\s+["']([^"']+)["']/gm,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

/** Every module specifier a file names: imports of any kind, re-exports and dynamic imports. */
export function importsOf(file: SourceFile): ImportEdge[] {
  const edges = new Map<string, ImportEdge>();
  const lineAt = (index: number) => file.content.slice(0, index).split("\n").length;
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of file.content.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier === undefined || match.index === undefined) continue;
      // Report the line that names the specifier, where a multi-line import ends.
      const at = match.index + match[0].lastIndexOf(specifier);
      const line = lineAt(at);
      const text = file.content.split("\n")[line - 1]?.trim() ?? "";
      edges.set(`${line}:${specifier}`, { line, text, specifier });
    }
  }
  return [...edges.values()].sort((a, b) => a.line - b.line);
}

/** The repository path an import names, without extension or a trailing `/index`; undefined for a package. */
export function resolveSpecifier(from: string, specifier: string): string | undefined {
  let target: string;
  if (specifier.startsWith("@/")) target = WEB + specifier.slice(2);
  else if (specifier.startsWith(".")) {
    const parts = from.split("/").slice(0, -1);
    for (const part of specifier.split("/")) {
      if (part === "..") parts.pop();
      else if (part !== ".") parts.push(part);
    }
    target = parts.join("/");
  } else return undefined;
  return target.replace(/\.(js|jsx|ts|tsx)$/, "").replace(/\/index$/, "");
}

/** The modules each web manifest says it uses: `uses: ["ACTIVITIES", …]` in `src/modules/<module>/manifest.ts`. */
export function declaredUses(files: readonly SourceFile[]): Map<ModuleCode, Set<ModuleCode>> {
  const uses = new Map<ModuleCode, Set<ModuleCode>>();
  for (const file of files) {
    if (!/^apps\/web\/src\/modules\/[^/]+\/manifest\.ts$/.test(file.path)) continue;
    const code = /\bcode:\s*"([A-Z]+)"/.exec(file.content)?.[1] as ModuleCode | undefined;
    if (code === undefined) continue;
    const list = /\buses:\s*\[([^\]]*)\]/.exec(file.content)?.[1] ?? "";
    uses.set(code, new Set([...list.matchAll(/"([A-Z]+)"/g)].map((match) => match[1] as ModuleCode)));
  }
  return uses;
}

/** One violation per import line that crosses a boundary the file may not cross. */
export function moduleBoundaryViolations(files: readonly SourceFile[]): Violation[] {
  const uses = declaredUses(files);
  return files
    .filter((file) => file.path.startsWith(WEB) && /\.tsx?$/.test(file.path) && !isTestFile(file.path) && !file.path.includes("/test/"))
    .flatMap((file) => {
      const from = ownerOf(file.path);
      if (from === undefined || from.kind === "composition") return [];
      return importsOf(file).flatMap((edge) => {
        const target = resolveSpecifier(file.path, edge.specifier);
        const to = target === undefined ? undefined : ownerOf(target);
        if (to === undefined || to.kind !== "module") return [];
        if (from.kind === "module" && (to.code === from.code || uses.get(from.code)?.has(to.code))) return [];
        const who = from.kind === "core" ? "core" : `${from.code} (undeclared)`;
        return [{ path: file.path, line: edge.line, text: `${who} → ${to.code}: ${edge.text}` }];
      });
    });
}
