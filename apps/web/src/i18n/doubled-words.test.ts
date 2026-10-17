import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import passengerEn from "./presets/passenger-transport.en.json";
import passengerFr from "./presets/passenger-transport.fr.json";
import truckingEn from "./presets/trucking.en.json";
import truckingFr from "./presets/trucking.fr.json";

/**
 * #563: "In in October" — a noun that is also a preposition read twice. A word
 * repeated back to back is a slip in any message; all-caps placeholders such as
 * a phone mask (XX XX) are left out.
 */
const DOUBLED = /\b(\w+)\s+\1\b/i;

function strings(node: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof node === "string") return [[path.join("."), node]];
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) => strings(value, [...path, key]));
}

describe("doubled words", () => {
  for (const [locale, catalogs] of [
    ["en", [en, truckingEn, passengerEn]],
    ["fr", [fr, truckingFr, passengerFr]],
  ] as const) {
    it(`${locale}: no message repeats a word back to back`, () => {
      const offending = catalogs
        .flatMap((catalog) => strings(catalog))
        .filter(([, value]) => DOUBLED.test(value.replace(/\b[A-Z]{2,}\b/g, "")));
      expect(offending).toEqual([]);
    });
  }
});
