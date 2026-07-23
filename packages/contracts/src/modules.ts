/**
 * Fixed module registry codes (ARCHITECTURE.md §3.3a). Code-level, never tenant data;
 * per-workspace enablement lives in the workspace_modules table. CORE is not disableable.
 */
export const MODULE_CODES = ["CORE", "ASSETS", "DOCUMENTS"] as const;

export type ModuleCode = (typeof MODULE_CODES)[number];
