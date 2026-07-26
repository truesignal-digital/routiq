import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) {
      return flattenKeys(value as Record<string, unknown>, path);
    }
    return [path];
  });
}

describe("locale catalogs", () => {
  it("fr and en expose exactly the same keys", () => {
    expect(flattenKeys(en).sort()).toEqual(flattenKeys(fr).sort());
  });

  it("no message is an empty string", () => {
    for (const catalog of [fr, en]) {
      for (const key of flattenKeys(catalog)) {
        const value = key
          .split(".")
          .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)[part], catalog);
        expect(value, key).toBeTruthy();
      }
    }
  });

  it("does not contain i18next-style interpolation", () => {
    for (const [locale, catalog] of [
      ["fr", fr],
      ["en", en],
    ] as const) {
      expect(JSON.stringify(catalog), locale).not.toContain("{{");
    }
  });
});
