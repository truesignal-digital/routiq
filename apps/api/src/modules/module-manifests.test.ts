import { MODULE_MANIFESTS, ROLES, type ModuleCode, type Role } from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listCommandDefinitions } from "../commands/dispatcher.js";
import { listReadGates } from "../reads/define-read.js";
import { createTestApp } from "../test/fixture.js";

/**
 * The manifests in `@routiq/contracts` say what each module owns; the API's
 * declarations decide it (`CommandDefinition.module`, `ReadGate.module`). This
 * keeps the two the same list, so the feature map and the web app can trust
 * the manifest.
 */
describe("module manifests against the API", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  const commandsOf = (module: ModuleCode) =>
    [
      ...new Set(
        listCommandDefinitions().flatMap((def) =>
          def.scope !== "platform" && def.module === module ? [def.name] : [],
        ),
      ),
    ].sort();

  const readsOf = (module: ModuleCode) =>
    [...listReadGates()].flatMap(([path, gate]) => (gate.module === module ? [path] : [])).sort();

  it.each(MODULE_MANIFESTS.map((manifest) => [manifest.code, manifest] as const))(
    "%s lists exactly the commands and reads the API gives it",
    (code, manifest) => {
      expect([...manifest.commands].sort()).toEqual(commandsOf(code));
      expect([...manifest.reads].sort()).toEqual(readsOf(code));
    },
  );

  it.each(MODULE_MANIFESTS.map((manifest) => [manifest.code, manifest] as const))(
    "%s names the roles its commands and reads accept",
    (code, manifest) => {
      const accepted = new Set<Role>();
      for (const def of listCommandDefinitions()) {
        if (def.scope !== "platform" && def.module === code) def.allowedRoles.forEach((role) => accepted.add(role));
      }
      for (const gate of listReadGates().values()) {
        if (gate.module === code) gate.roles.forEach((role) => accepted.add(role));
      }
      expect(manifest.roles).toEqual(ROLES.filter((role) => accepted.has(role)));
    },
  );
});
