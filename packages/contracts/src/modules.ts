/**
 * Fixed module registry codes (ARCHITECTURE.md §3.3a). Code-level, never tenant data;
 * per-workspace enablement lives in the workspace_modules table. CORE is not disableable.
 */
export const TOGGLEABLE_MODULE_CODES = [
  "ASSETS",
  "DOCUMENTS",
  "FINANCE",
  "ACTIVITIES",
] as const;
export const MODULE_CODES = ["CORE", ...TOGGLEABLE_MODULE_CODES] as const;

export type ModuleCode = (typeof MODULE_CODES)[number];
