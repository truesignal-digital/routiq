import type { QueryClient } from "@tanstack/react-query";
import { meQueryOptions } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { installAppModules } from "./index.js";
import { pageOwner } from "./manifest.js";

/**
 * The shell, with every module's manifest installed before it first renders.
 * The router loads the shell from here, so the manifests come with the shell's
 * code and the sign-in page carries neither (#480).
 */
installAppModules();

export { AppShell } from "../shell/AppShell.js";

/**
 * Whether a page's module is on, judged as ModulePageGate judges it; an
 * unknown member counts as off. The router's loaders ask before starting a
 * page's reads (#496): with the module off every read would be refused. Here
 * because the answer needs the installed manifests, which come with the shell.
 */
export async function pageModuleOn(client: QueryClient, pathname: string): Promise<boolean> {
  const owner = pageOwner(pathname);
  if (owner === undefined) return true;
  const me = await client.ensureQueryData(meQueryOptions(client, sessionStore.getActive())).catch(() => undefined);
  return me?.enabledModules.includes(owner.code) ?? false;
}
