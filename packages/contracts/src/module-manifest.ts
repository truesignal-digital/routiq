import { TOGGLEABLE_MODULE_CODES, type ModuleCode, type ToggleableModuleCode } from "./modules.js";
import { ROLES, type Role } from "./roles.js";
import { TEMPLATE_CODES, type TemplateCode } from "./templates.js";

/**
 * What a workspace sees, and keeps, while a module is off (AGENTS.md, "Core vs
 * modules"). The four fixed parts are the same for every module and are typed
 * as literals so no manifest can promise less; `instead` says what the rest of
 * the application does in its place.
 */
export interface ModuleOffState {
  /** Its sidebar rows, tabs, buttons, fields and Home cards are hidden, never greyed (#64). */
  entryPoints: "hidden";
  /** A direct link to one of its pages says the module is not included and loads none of its data. */
  directLinks: "not-included";
  /** Its commands and reads answer 403 MODULE_DISABLED, whoever calls; the server decides. */
  server: "MODULE_DISABLED";
  /** Its records stay untouched and come back as they were when it is turned on again. */
  records: "kept";
  /** What the application does in its place. */
  instead: string;
}

/**
 * One module's contract, shared by the API, the web app and the feature map.
 * UI-free on purpose: the web app's manifest (`apps/web/src/modules/`) adds
 * the sidebar rows, tabs, buttons, fields and Home cards against this code.
 */
export interface ModuleManifest {
  code: ToggleableModuleCode;
  /**
   * Modules that must stay on while this one is on. The vendor cannot turn one
   * of them off first, nor turn this one on without them (`moduleToggleRefusal`).
   */
  requires: readonly ToggleableModuleCode[];
  /** Whether a new workspace of each preset starts with the module on (ADR-0005: the vendor changes it). */
  presetDefaults: Readonly<Record<TemplateCode, boolean>>;
  /** Every command the module owns: `CommandDefinition.module` names it (API test `module-manifests.test.ts`). */
  commands: readonly string[];
  /** Every read the module owns, by route path: `ReadGate.module` names it. */
  reads: readonly string[];
  /** The roles with work in the module: those its commands and reads accept. */
  roles: readonly Role[];
  whenOff: ModuleOffState;
}

const ALL_ROLES: readonly Role[] = ROLES;

const everyPreset = (on: boolean): Record<TemplateCode, boolean> =>
  Object.fromEntries(TEMPLATE_CODES.map((preset) => [preset, on])) as Record<TemplateCode, boolean>;

const offState = (instead: string): ModuleOffState => ({
  entryPoints: "hidden",
  directLinks: "not-included",
  server: "MODULE_DISABLED",
  records: "kept",
  instead,
});

/** Every toggleable module, in registry order. CORE has no manifest: it is the application. */
export const MODULE_MANIFESTS: readonly ModuleManifest[] = [
  {
    code: "ASSETS",
    requires: [],
    presetDefaults: /* @__PURE__ */ everyPreset(true),
    commands: ["assign-asset", "commission-asset", "register-asset", "update-asset-details"],
    reads: [
      "/v1/assets",
      "/v1/assets/:assetId",
      "/v1/assets/:assetId/attention",
      "/v1/assets/:assetId/custodian-candidates",
      "/v1/assets/:assetId/history",
      "/v1/assets/summary",
    ],
    roles: ALL_ROLES,
    whenOff: /* @__PURE__ */ offState("No fleet list and no vehicle pages; records made on vehicles stay where other modules show them."),
  },
  {
    code: "DOCUMENTS",
    requires: [],
    presetDefaults: /* @__PURE__ */ everyPreset(true),
    commands: ["add-or-renew-document"],
    reads: ["/v1/assets/:assetId/documents"],
    // The counter has no papers to keep or read.
    roles: ["DIRECTOR", "ADMIN", "FINANCE", "TECHNICIAN", "DRIVER"],
    whenOff: /* @__PURE__ */ offState("Vehicles show no papers and no expiry warnings."),
  },
  {
    code: "FINANCE",
    requires: [],
    presetDefaults: /* @__PURE__ */ everyPreset(true),
    commands: [
      "approve-entry",
      "attach-evidence",
      "lock-period",
      "record-expense",
      "record-revenue",
      "reject-entry",
      "reopen-period",
      "reverse-entry",
      "update-pending-entry",
    ],
    reads: [
      "/v1/approval-thresholds",
      "/v1/assets/:assetId/finance",
      "/v1/finance/approvals",
      "/v1/finance/entries",
      "/v1/finance/entries/:entryId",
      "/v1/finance/periods",
      "/v1/finance/summary",
    ],
    roles: ALL_ROLES,
    whenOff: /* @__PURE__ */ offState("No money pages, totals or costs anywhere; trips and work orders keep their other facts."),
  },
  {
    code: "ACTIVITIES",
    requires: [],
    presetDefaults: /* @__PURE__ */ everyPreset(true),
    commands: [
      "close-activity",
      "create-activity",
      "record-haulage-job-sheet",
      "record-journey-sheet",
      "record-meter-reading",
      "record-movement-leg",
      "register-person",
      "reopen-activity",
      "substitute-asset",
    ],
    reads: [
      "/v1/activities",
      "/v1/activities/:activityId",
      "/v1/activities/summary",
      "/v1/assets/:assetId/readings",
      "/v1/persons",
      "/v1/places",
    ],
    roles: ALL_ROLES,
    whenOff: /* @__PURE__ */ offState("No trips, readings or people list; vehicles show no trip history."),
  },
  {
    code: "MAINTENANCE",
    requires: [],
    presetDefaults: /* @__PURE__ */ everyPreset(true),
    commands: [
      "approve-work-order",
      "approve-work-order-closure",
      "cancel-work-order",
      "change-issue-severity",
      "complete-work-order",
      "create-work-order",
      "dismiss-issue",
      "reject-work-order",
      "reject-work-order-completion",
      "release-asset-to-service",
      "report-issue",
      "resolve-issue",
    ],
    reads: [
      "/v1/issues",
      "/v1/issues/:issueId",
      "/v1/maintenance/summary",
      "/v1/work-orders",
      "/v1/work-orders/:workOrderId",
    ],
    roles: ALL_ROLES,
    whenOff: /* @__PURE__ */ offState(
      "No workshop page, problems or work orders; a vehicle shows no grounding and nobody can report a problem.",
    ),
  },
  {
    code: "SCHEDULING",
    requires: ["ACTIVITIES"],
    // ADR-0012 §8: off for every preset until the vendor turns it on.
    presetDefaults: /* @__PURE__ */ everyPreset(false),
    commands: [
      "assign-trip",
      "cancel-planned-trip",
      "plan-trip",
      "reschedule-trip",
      "start-planned-trip",
      "update-planned-trip",
    ],
    reads: ["/v1/planning"],
    roles: ["DIRECTOR", "ADMIN", "FINANCE", "TECHNICIAN", "DRIVER"],
    whenOff: /* @__PURE__ */ offState("No planning; trips start as they do today."),
  },
];

/** Modules a workspace does not have until the vendor turns them on (ADR-0005, ADR-0012 §8). */
export const MODULES_OFF_BY_DEFAULT: readonly ModuleCode[] = /* @__PURE__ */ offByDefault(MODULE_MANIFESTS);

// The manifests are data the web app's first load never reads: the pure marks let it drop them.
function offByDefault(manifests: readonly ModuleManifest[]): ModuleCode[] {
  return manifests
    .filter((manifest) => TEMPLATE_CODES.every((preset) => !manifest.presetDefaults[preset]))
    .map((manifest) => manifest.code);
}

/**
 * Whether a module is on, given the workspace's workspace_modules row for it,
 * if any. No row means the module's default; CORE is always on.
 */
export function isModuleOn(code: ModuleCode, row: { enabled: boolean } | undefined): boolean {
  if (code === "CORE") return true;
  return row?.enabled ?? !MODULES_OFF_BY_DEFAULT.includes(code);
}

export function moduleManifest(code: ToggleableModuleCode): ModuleManifest {
  const manifest = MODULE_MANIFESTS.find((candidate) => candidate.code === code);
  if (manifest === undefined) throw new Error(`no manifest for module ${code}`);
  return manifest;
}

export type ModuleToggleRefusal =
  | { code: "MODULE_STILL_REQUIRED"; metadata: { module: ToggleableModuleCode; requiredBy: ToggleableModuleCode[] } }
  | { code: "MODULE_DEPENDENCY_DISABLED"; metadata: { module: ToggleableModuleCode; requires: ToggleableModuleCode[] } };

/**
 * Why turning `code` on or off would leave a module on without one it
 * requires, given the modules on now; undefined when the change is allowed.
 * Off is refused while a module that requires it is on; on is refused while a
 * module it requires is off.
 */
export function moduleToggleRefusal(
  code: ToggleableModuleCode,
  enable: boolean,
  enabledNow: ReadonlySet<ModuleCode>,
  manifests: readonly ModuleManifest[] = MODULE_MANIFESTS,
): ModuleToggleRefusal | undefined {
  if (enable) {
    const own = manifests.find((manifest) => manifest.code === code);
    const missing = (own?.requires ?? []).filter((required) => !enabledNow.has(required));
    return missing.length === 0
      ? undefined
      : { code: "MODULE_DEPENDENCY_DISABLED", metadata: { module: code, requires: missing } };
  }
  const requiredBy = manifests
    .filter((manifest) => manifest.requires.includes(code) && enabledNow.has(manifest.code))
    .map((manifest) => manifest.code);
  return requiredBy.length === 0
    ? undefined
    : { code: "MODULE_STILL_REQUIRED", metadata: { module: code, requiredBy } };
}

/**
 * Everything wrong with a set of manifests, in words; empty when they hold.
 * A missing or duplicate module, a dependency on an unknown module or on
 * itself, a dependency cycle, a command or read claimed twice, and defaults
 * the runtime cannot honour.
 */
export function moduleManifestProblems(
  manifests: readonly ModuleManifest[],
  codes: readonly ToggleableModuleCode[] = TOGGLEABLE_MODULE_CODES,
): string[] {
  const problems: string[] = [];
  const byCode = new Map<string, ModuleManifest>();
  for (const manifest of manifests) {
    if (byCode.has(manifest.code)) problems.push(`${manifest.code} has two manifests`);
    byCode.set(manifest.code, manifest);
  }
  for (const code of codes) {
    if (!byCode.has(code)) problems.push(`${code} has no manifest`);
  }

  for (const manifest of manifests) {
    for (const required of manifest.requires) {
      if (required === manifest.code) problems.push(`${manifest.code} requires itself`);
      else if (!byCode.has(required)) problems.push(`${manifest.code} requires ${required}, which has no manifest`);
    }
    const defaults = new Set(TEMPLATE_CODES.map((preset) => manifest.presetDefaults[preset]));
    // isModuleOn reads no preset yet: a default that differs by preset would be ignored.
    if (defaults.size > 1) problems.push(`${manifest.code} has a different default per preset`);
    const onByDefault = defaults.has(true);
    for (const required of manifest.requires) {
      const dependency = byCode.get(required);
      if (onByDefault && dependency !== undefined && TEMPLATE_CODES.every((p) => !dependency.presetDefaults[p])) {
        problems.push(`${manifest.code} is on by default but requires ${required}, which is off by default`);
      }
    }
  }

  for (const cycle of dependencyCycles(manifests)) problems.push(`dependency cycle: ${cycle.join(" → ")}`);

  for (const kind of ["commands", "reads"] as const) {
    const owners = new Map<string, string>();
    for (const manifest of manifests) {
      for (const name of manifest[kind]) {
        const owner = owners.get(name);
        if (owner !== undefined && owner !== manifest.code) {
          problems.push(`${name} is claimed by ${owner} and ${manifest.code}`);
        }
        owners.set(name, manifest.code);
      }
    }
  }
  return problems;
}

function dependencyCycles(manifests: readonly ModuleManifest[]): string[][] {
  const requires = new Map(manifests.map((manifest) => [manifest.code as string, manifest.requires]));
  const cycles: string[][] = [];
  const done = new Set<string>();
  const visit = (code: string, path: string[]) => {
    if (path.includes(code)) {
      cycles.push([...path.slice(path.indexOf(code)), code]);
      return;
    }
    if (done.has(code)) return;
    for (const next of requires.get(code) ?? []) visit(next, [...path, code]);
    done.add(code);
  };
  for (const manifest of manifests) visit(manifest.code, []);
  return cycles;
}
