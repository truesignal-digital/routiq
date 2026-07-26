import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

function flattenKeys(value: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return typeof child === "object" && child !== null
      ? flattenKeys(child as Record<string, unknown>, path)
      : [path];
  });
}

const financeLocaleSuite = describe("finance locale catalogs", () => {
  it("contains every finance key in both English and French", () => {
    const enKeys = flattenKeys(en.finance).sort();
    const frKeys = flattenKeys(fr.finance).sort();

    for (const key of enKeys) {
      expect(frKeys, `French catalog is missing finance.${key}`).toContain(key);
    }
    for (const key of frKeys) {
      expect(enKeys, `English catalog is missing finance.${key}`).toContain(key);
    }
    expect(enKeys).toEqual(frKeys);
  });
});

export default financeLocaleSuite;
