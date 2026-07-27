import { describe, expect, it } from "vitest";
import { activeSection, isSectionActive, visibleSections } from "./sections.js";

const ALL = visibleSections(["CORE", "ASSETS", "FINANCE"]);

function activeKey(pathname: string): string | undefined {
  return activeSection(ALL, pathname)?.key;
}

describe("visibleSections (module gate)", () => {
  it("disabled module removes its section entirely", () => {
    const keys = visibleSections(["CORE"]).map((s) => s.key);
    expect(keys).toEqual(["more"]);
  });

  it("enabled module shows its section", () => {
    const keys = visibleSections(["CORE", "ASSETS"]).map((s) => s.key);
    expect(keys).toEqual(["assets", "more"]);
  });

  it("finance module shows the finances section", () => {
    const keys = visibleSections(["CORE", "FINANCE"]).map((s) => s.key);
    expect(keys).toEqual(["finances", "more"]);
  });

  it("while membership is loading only module-less sections render", () => {
    expect(visibleSections(undefined).map((s) => s.key)).toEqual(["more"]);
  });
});

describe("isSectionActive (exact-or-child)", () => {
  it("matches the section's own route", () => {
    expect(activeKey("/assets")).toBe("assets");
    expect(activeKey("/more")).toBe("more");
  });

  it("matches child routes", () => {
    expect(activeKey("/assets/new")).toBe("assets");
    expect(activeKey("/assets/abc-123/documents")).toBe("assets");
  });

  it("a section owning a subtree stays active across its siblings", () => {
    expect(activeKey("/finance/entries")).toBe("finances");
    expect(activeKey("/finance/periods")).toBe("finances");
    expect(activeKey("/finance/approvals")).toBe("finances");
  });

  it("never matches a route that merely shares a string prefix", () => {
    expect(activeKey("/assets-archive")).toBeUndefined();
    expect(activeKey("/financements")).toBeUndefined();
    expect(activeKey("/moreover")).toBeUndefined();
  });

  it("no section owns an unrelated route", () => {
    expect(activeKey("/login")).toBeUndefined();
  });

  it("ignores a trailing slash on either side", () => {
    const assets = ALL.find((s) => s.key === "assets");
    expect(assets && isSectionActive(assets, "/assets/")).toBe(true);
  });

  it("a hidden section cannot be the active one", () => {
    expect(activeSection(visibleSections(["CORE"]), "/finance/entries")).toBeUndefined();
  });
});
