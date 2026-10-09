/**
 * Fixed module registry codes (ARCHITECTURE.md §3.3a). Code-level, never tenant data;
 * per-workspace enablement lives in the workspace_modules table. CORE is not disableable.
 */
export const TOGGLEABLE_MODULE_CODES = [
  "ASSETS",
  "DOCUMENTS",
  "FINANCE",
  "ACTIVITIES",
  "MAINTENANCE",
  /** Planned trips (ADR-0012). Depends on ACTIVITIES. */
  "SCHEDULING",
] as const;
export const MODULE_CODES = ["CORE", ...TOGGLEABLE_MODULE_CODES] as const;

export type ModuleCode = (typeof MODULE_CODES)[number];

/**
 * Modules a workspace does not have until the vendor turns them on (ADR-0005).
 * Every other module is on while the workspace has no row for it; these are
 * off. ADR-0012 §8: Scheduling is off by default for every preset.
 */
export const MODULES_OFF_BY_DEFAULT: readonly ModuleCode[] = ["SCHEDULING"];

/** Whether a module is on, given the workspace's workspace_modules row for it, if any. */
export function isModuleOn(code: ModuleCode, row: { enabled: boolean } | undefined): boolean {
  if (code === "CORE") return true;
  return row?.enabled ?? !MODULES_OFF_BY_DEFAULT.includes(code);
}
