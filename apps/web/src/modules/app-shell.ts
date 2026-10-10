import { installAppModules } from "./index.js";

/**
 * The shell, with every module's manifest installed before it first renders.
 * The router loads the shell from here, so the manifests come with the shell's
 * code and the sign-in page carries neither (#480).
 */
installAppModules();

export { AppShell } from "../shell/AppShell.js";
