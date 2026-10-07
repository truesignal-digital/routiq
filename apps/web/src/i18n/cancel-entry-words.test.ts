import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import passengerEn from "./presets/passenger-transport.en.json";
import passengerFr from "./presets/passenger-transport.fr.json";
import truckingEn from "./presets/trucking.en.json";
import truckingFr from "./presets/trucking.fr.json";

/**
 * #426: people who are not accountants read "Cancel entry", never "reverse".
 * The command, the REVERSED status and the glossary keep the accounting word;
 * nothing a person reads does. ICU select keys are codes, so all-caps words
 * are left out of the scan.
 */
const ACCOUNTING_WORDS = {
  en: /revers/i,
  fr: /revers|extourn|contre-pass/i,
} as const;

function strings(node: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof node === "string") return [[path.join("."), node]];
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) => strings(value, [...path, key]));
}

describe("cancel-entry words", () => {
  for (const [locale, catalogs] of [
    ["en", [en, truckingEn, passengerEn]],
    ["fr", [fr, truckingFr, passengerFr]],
  ] as const) {
    it(`${locale} says cancel, never reverse`, () => {
      const offending = catalogs
        .flatMap((catalog) => strings(catalog))
        .filter(([, value]) => ACCOUNTING_WORDS[locale].test(value.replace(/\b[A-Z][A-Z_]+\b/g, "")));
      expect(offending).toEqual([]);
    });
  }

  it("names the action and its four reasons in both languages", () => {
    expect(en.commands["reverse-entry"].label).toBe("Cancel entry");
    expect(fr.commands["reverse-entry"].label).toBe("Annuler l'écriture");
    expect(en.finance.entries.status.REVERSED).toBe("Cancelled");
    expect(fr.finance.entries.status.REVERSED).toBe("Annulée");
    expect(en.reasonCodes).toEqual({
      ENTERED_TWICE: "Entered twice",
      DID_NOT_HAPPEN: "Didn't happen",
      WRONG_DETAILS: "Wrong details, to record again",
      OTHER: "Other",
    });
    expect(Object.keys(fr.reasonCodes)).toEqual(Object.keys(en.reasonCodes));
  });
});
