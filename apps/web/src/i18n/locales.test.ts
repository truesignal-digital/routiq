import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import passengerEn from "./presets/passenger-transport.en.json";
import passengerFr from "./presets/passenger-transport.fr.json";
import truckingEn from "./presets/trucking.en.json";
import truckingFr from "./presets/trucking.fr.json";

function flattenEntries(obj: Record<string, unknown>, prefix = ""): [string, string][] {
  return Object.entries(obj).flatMap(([key, value]): [string, string][] => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) {
      return flattenEntries(value as Record<string, unknown>, path);
    }
    return [[path, String(value)]];
  });
}

/** The words a reader sees: ICU select keys and argument names removed, case text kept. */
function visibleWords(message: string): string {
  return message
    .replace(/([,}])\s*[\w=]+\s*\{/g, "$1«")
    .replace(/\{\s*\w+\s*(?=[,}])/g, "{");
}

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

  // One word per concept (#288): a reported fault is a "problem" in English and
  // a « problème » in French, on every screen, toast, error and history line.
  it("calls a reported fault a problem, never an issue or a signalement", () => {
    for (const catalog of [en, truckingEn, passengerEn]) {
      for (const [key, value] of flattenEntries(catalog)) {
        expect(visibleWords(value), key).not.toMatch(/\bissues?\b/i);
      }
    }
    for (const catalog of [fr, truckingFr, passengerFr]) {
      for (const [key, value] of flattenEntries(catalog)) {
        expect(visibleWords(value), key).not.toMatch(/\bsignalements?\b/i);
      }
    }
  });
});
