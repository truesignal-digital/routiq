import { activitiesManifest } from "./activities/manifest.js";
import { assetsManifest } from "./assets/manifest.js";
import { documentsManifest } from "./documents/manifest.js";
import { financeManifest } from "./finance/manifest.js";
import { maintenanceManifest } from "./maintenance/manifest.js";
import { installModules, type WebModuleManifest } from "./manifest.js";

/**
 * The composition entry: the one place that knows every module. Core reads
 * the installed manifests (`manifest.ts`) and never imports a module; a new
 * module adds its manifest here. Scheduling has no screen yet, so no manifest.
 */
export const APP_MODULES: readonly WebModuleManifest[] = [
  assetsManifest,
  documentsManifest,
  financeManifest,
  activitiesManifest,
  maintenanceManifest,
];

export function installAppModules(): void {
  installModules(APP_MODULES);
}
