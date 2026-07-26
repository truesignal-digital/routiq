import { describe, expect, it } from "vitest";
import { visibleSections } from "./sections.js";

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
