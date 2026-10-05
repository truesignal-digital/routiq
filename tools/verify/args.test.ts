import { describe, expect, it } from "vitest";
import { parseArgs, parseSlot, parseViewport } from "./args.js";

describe("parseArgs", () => {
  it("shows help with no command or --help", () => {
    expect(parseArgs([])).toEqual({ name: "help" });
    expect(parseArgs(["--help"])).toEqual({ name: "help" });
    expect(parseArgs(["drive", "--help"])).toEqual({ name: "help" });
  });

  it("defaults to slot 1, then ROUTIQ_VERIFY_SLOT, then --slot", () => {
    expect(parseArgs(["up"])).toEqual({ name: "up", slot: 1, reseed: false });
    expect(parseArgs(["up"], { ROUTIQ_VERIFY_SLOT: "4" })).toEqual({ name: "up", slot: 4, reseed: false });
    expect(parseArgs(["up", "--slot", "2", "--reseed"], { ROUTIQ_VERIFY_SLOT: "4" })).toEqual({ name: "up", slot: 2, reseed: true });
    expect(parseArgs(["down", "--slot=3"])).toEqual({ name: "down", slot: 3 });
  });

  it("parses drive targets and options, and treats ui as drive", () => {
    expect(parseArgs(["ui", "/assets", "/finance/entries", "--role", "manager", "--lang", "en", "--video"])).toEqual({
      name: "drive",
      slot: 1,
      targets: ["/assets", "/finance/entries"],
      options: { role: "manager", lang: "en", video: true, strict: false, headed: false, viewport: { width: 1440, height: 900 } },
    });
  });

  it("parses api calls", () => {
    expect(parseArgs(["api", "get", "/v1/me", "--role", "finance"])).toEqual({ name: "api", slot: 1, method: "GET", path: "/v1/me", role: "finance", body: undefined });
    expect(parseArgs(["api", "POST", "/v1/commands/x", "--json", '{"a":1}'])).toMatchObject({ method: "POST", body: '{"a":1}', role: "director" });
  });

  it("takes exactly one query for db", () => {
    expect(parseArgs(["db", "select 1"])).toEqual({ name: "db", slot: 1, sql: "select 1" });
    expect(() => parseArgs(["db"])).toThrow(/one quoted query/);
    expect(() => parseArgs(["db", "select", "1"])).toThrow(/one quoted query/);
  });

  it("rejects unknown commands, unknown options and bad values", () => {
    expect(() => parseArgs(["deploy"])).toThrow(/unknown command/);
    expect(() => parseArgs(["up", "--force"])).toThrow(/unknown option --force/);
    expect(() => parseArgs(["drive"])).toThrow(/needs a route/);
    expect(() => parseArgs(["drive", "/", "--lang", "de"])).toThrow(/fr or en/);
    expect(() => parseArgs(["api", "FETCH", "/v1/me"])).toThrow(/method/);
    expect(() => parseArgs(["api", "GET", "v1/me"])).toThrow(/starting with \//);
    expect(() => parseArgs(["up", "--slot"])).toThrow(/needs a value/);
    expect(() => parseArgs(["up", "extra"])).toThrow(/takes no arguments/);
  });
});

describe("parseSlot", () => {
  it("rejects non-numbers and out-of-range slots", () => {
    expect(() => parseSlot("x", {})).toThrow(/whole number/);
    expect(() => parseSlot("-1", {})).toThrow(/whole number/);
    expect(() => parseSlot("100", {})).toThrow(/0 to 99/);
  });
});

describe("parseViewport", () => {
  it("reads WIDTHxHEIGHT", () => {
    expect(parseViewport("360x740")).toEqual({ width: 360, height: 740 });
    expect(() => parseViewport("big")).toThrow(/1440x900/);
  });
});
