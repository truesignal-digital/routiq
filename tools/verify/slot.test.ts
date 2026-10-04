import { describe, expect, it } from "vitest";
import { MAX_SLOT, MIN_SLOT, RESERVED_PORTS, assertVerifyProject, projectName, runDirName, slotPorts } from "./slot.js";

describe("slotPorts", () => {
  it("gives slot N the block 24000+10N", () => {
    expect(slotPorts(1)).toEqual({ postgres: 24010, storage: 24011, api: 24012, web: 24013 });
    expect(slotPorts(0)).toEqual({ postgres: 24000, storage: 24001, api: 24002, web: 24003 });
  });

  it("never shares a port between two slots or with the owner's stack", () => {
    const seen = new Set<number>();
    for (let slot = MIN_SLOT; slot <= MAX_SLOT; slot += 1) {
      for (const port of Object.values(slotPorts(slot))) {
        expect(seen.has(port)).toBe(false);
        expect(RESERVED_PORTS.has(port)).toBe(false);
        seen.add(port);
      }
    }
    for (const port of [5435, 3001, 5173, 8080]) expect(RESERVED_PORTS.has(port)).toBe(true);
  });

  it("rejects slots outside 0-99 and fractions", () => {
    expect(() => slotPorts(-1)).toThrow(/0 to 99/);
    expect(() => slotPorts(100)).toThrow(/0 to 99/);
    expect(() => slotPorts(1.5)).toThrow(/0 to 99/);
  });
});

describe("compose project names", () => {
  it("names slot projects routiq-verify-N", () => {
    expect(projectName(7)).toBe("routiq-verify-7");
  });

  it("refuses anything that is not a verify project, so down -v cannot reach the dev stack", () => {
    expect(() => assertVerifyProject("routiq-verify-7")).not.toThrow();
    for (const name of ["routiq", "routiq-demo", "routiq-verify", "routiq-verify-1; rm", "routiq_verify_1"]) {
      expect(() => assertVerifyProject(name)).toThrow(/refusing/);
    }
  });
});

describe("runDirName", () => {
  it("sorts by time and names the command and slot", () => {
    expect(runDirName("drive", 2, new Date("2026-10-03T20:51:07.123Z"))).toBe("2026-10-03T20-51-07Z-drive-s2");
  });
});
