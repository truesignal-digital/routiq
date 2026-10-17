import { describe, expect, it } from "vitest";
import {
  isModuleOn,
  MODULE_MANIFESTS,
  MODULES_OFF_BY_DEFAULT,
  moduleManifest,
  moduleManifestProblems,
  moduleToggleRefusal,
  type ModuleManifest,
} from "./module-manifest.js";
import { TOGGLEABLE_MODULE_CODES, type ModuleCode } from "./modules.js";

const manifest = (overrides: Partial<ModuleManifest> & Pick<ModuleManifest, "code">): ModuleManifest => ({
  requires: [],
  presetDefaults: { TRUCKING: true, PASSENGER_TRANSPORT: true },
  commands: [],
  reads: [],
  roles: ["DIRECTOR"],
  whenOff: {
    entryPoints: "hidden",
    directLinks: "not-included",
    server: "MODULE_DISABLED",
    records: "kept",
    instead: "nothing",
  },
  ...overrides,
});

describe("module manifests", () => {
  it("declare every toggleable module once, with nothing wrong", () => {
    expect(MODULE_MANIFESTS.map((m) => m.code)).toEqual([...TOGGLEABLE_MODULE_CODES]);
    expect(moduleManifestProblems(MODULE_MANIFESTS)).toEqual([]);
  });

  it("give every module its roles, its off state and at least one command", () => {
    for (const m of MODULE_MANIFESTS) {
      expect(m.roles.length, m.code).toBeGreaterThan(0);
      expect(m.commands.length, m.code).toBeGreaterThan(0);
      expect(m.whenOff.instead.length, m.code).toBeGreaterThan(0);
    }
  });

  it("make Scheduling need Trips (ADR-0012 §8) and Maintenance stand alone", () => {
    expect(moduleManifest("SCHEDULING").requires).toEqual(["ACTIVITIES"]);
    expect(moduleManifest("MAINTENANCE").requires).toEqual([]);
  });

  it("derive the off-by-default list from the preset defaults", () => {
    expect(MODULES_OFF_BY_DEFAULT).toEqual(["SCHEDULING"]);
    expect(isModuleOn("SCHEDULING", undefined)).toBe(false);
    expect(isModuleOn("MAINTENANCE", undefined)).toBe(true);
    expect(isModuleOn("MAINTENANCE", { enabled: false })).toBe(false);
    expect(isModuleOn("CORE", { enabled: false })).toBe(true);
  });
});

describe("moduleManifestProblems", () => {
  const codes = ["ASSETS", "FINANCE", "MAINTENANCE"] as const;

  it("names a missing and a duplicate module", () => {
    expect(
      moduleManifestProblems([manifest({ code: "ASSETS" }), manifest({ code: "ASSETS" })], codes),
    ).toEqual(["ASSETS has two manifests", "FINANCE has no manifest", "MAINTENANCE has no manifest"]);
  });

  it("names a dependency on an unknown module and on itself", () => {
    expect(
      moduleManifestProblems(
        [
          manifest({ code: "ASSETS", requires: ["ASSETS"] }),
          manifest({ code: "FINANCE", requires: ["SCHEDULING"] }),
          manifest({ code: "MAINTENANCE" }),
        ],
        codes,
      ),
    ).toEqual([
      "ASSETS requires itself",
      "FINANCE requires SCHEDULING, which has no manifest",
      "dependency cycle: ASSETS → ASSETS",
    ]);
  });

  it("names a dependency cycle", () => {
    expect(
      moduleManifestProblems(
        [
          manifest({ code: "ASSETS", requires: ["FINANCE"] }),
          manifest({ code: "FINANCE", requires: ["MAINTENANCE"] }),
          manifest({ code: "MAINTENANCE", requires: ["ASSETS"] }),
        ],
        codes,
      ),
    ).toEqual(["dependency cycle: ASSETS → FINANCE → MAINTENANCE → ASSETS"]);
  });

  it("names a command or read two modules claim", () => {
    expect(
      moduleManifestProblems(
        [
          manifest({ code: "ASSETS", commands: ["register-asset"], reads: ["/v1/assets"] }),
          manifest({ code: "FINANCE", commands: ["register-asset"] }),
          manifest({ code: "MAINTENANCE", reads: ["/v1/assets"] }),
        ],
        codes,
      ),
    ).toEqual([
      "register-asset is claimed by ASSETS and FINANCE",
      "/v1/assets is claimed by ASSETS and MAINTENANCE",
    ]);
  });

  it("names defaults the runtime cannot honour", () => {
    expect(
      moduleManifestProblems(
        [
          manifest({ code: "ASSETS", presetDefaults: { TRUCKING: true, PASSENGER_TRANSPORT: false } }),
          manifest({ code: "FINANCE", presetDefaults: { TRUCKING: false, PASSENGER_TRANSPORT: false } }),
          manifest({ code: "MAINTENANCE", requires: ["FINANCE"] }),
        ],
        codes,
      ),
    ).toEqual([
      "ASSETS has a different default per preset",
      "MAINTENANCE is on by default but requires FINANCE, which is off by default",
    ]);
  });
});

describe("moduleToggleRefusal", () => {
  const on = (...codes: ModuleCode[]) => new Set<ModuleCode>(["CORE", ...codes]);

  it("refuses Trips off while Scheduling is on, and allows it once Scheduling is off", () => {
    expect(moduleToggleRefusal("ACTIVITIES", false, on("ACTIVITIES", "SCHEDULING"))).toEqual({
      code: "MODULE_STILL_REQUIRED",
      metadata: { module: "ACTIVITIES", requiredBy: ["SCHEDULING"] },
    });
    expect(moduleToggleRefusal("ACTIVITIES", false, on("ACTIVITIES"))).toBeUndefined();
  });

  it("refuses Scheduling on while Trips is off, and allows it once Trips is on", () => {
    expect(moduleToggleRefusal("SCHEDULING", true, on("MAINTENANCE"))).toEqual({
      code: "MODULE_DEPENDENCY_DISABLED",
      metadata: { module: "SCHEDULING", requires: ["ACTIVITIES"] },
    });
    expect(moduleToggleRefusal("SCHEDULING", true, on("ACTIVITIES"))).toBeUndefined();
  });

  it("lets Maintenance go off and on whatever else is on", () => {
    const all = on(...TOGGLEABLE_MODULE_CODES);
    expect(moduleToggleRefusal("MAINTENANCE", false, all)).toBeUndefined();
    expect(moduleToggleRefusal("MAINTENANCE", true, on())).toBeUndefined();
  });
});
