import { installModules, type WebModuleManifest } from "./manifest.js";
import { maintenanceManifest } from "./maintenance/manifest.js";

/**
 * The composition entry: the one place that knows every module. Core reads
 * the installed manifests (`manifest.ts`) and never imports a module; a new
 * module adds its manifest here.
 */
export const APP_MODULES: readonly WebModuleManifest[] = [maintenanceManifest];

export function installAppModules(): void {
  installModules(APP_MODULES);
}
