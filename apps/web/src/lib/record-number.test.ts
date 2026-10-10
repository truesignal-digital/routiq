import { describe, expect, it } from "vitest";
import { i18n } from "../i18n/index.js";
import { recordNumberText } from "./record-number.js";

/**
 * Work orders and problems carry a server number (#608); the prefix is each
 * language's own, and a record the server has not numbered yet says so.
 */
describe("recordNumberText", () => {
  const fr = i18n.getFixedT("fr");
  const en = i18n.getFixedT("en");

  it("prefixes a work order in each language and pads to four digits", () => {
    expect(recordNumberText(fr, "work_order", 7)).toBe("OT-0007");
    expect(recordNumberText(en, "work_order", 7)).toBe("WO-0007");
  });

  it("prefixes a problem in each language", () => {
    expect(recordNumberText(fr, "issue", 3)).toBe("PB-0003");
    expect(recordNumberText(en, "issue", 3)).toBe("PRB-0003");
  });

  it("never cuts a number past four digits or groups its thousands", () => {
    expect(recordNumberText(fr, "work_order", 12345)).toBe("OT-12345");
    expect(recordNumberText(en, "issue", 1000)).toBe("PRB-1000");
  });

  it("says the number is pending for a record the server has not numbered yet", () => {
    expect(recordNumberText(fr, "work_order", null)).toBe("numéro en attente");
    expect(recordNumberText(en, "issue", null)).toBe("number pending");
  });
});
