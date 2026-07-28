import { COMMAND_WARNING_CODES } from "@routiq/contracts";
import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

/**
 * The sibling guard to error-map.test.ts, and the one that did not exist while
 * warnings lived under `finance.record.warnings.*`. Key parity alone cannot
 * catch a code missing from BOTH catalogs, so a backend ticket could add a
 * warning and ship it to the UI as a raw enum. Every code the API can return now
 * has to have words in fr and en.
 */
describe("warning map completeness", () => {
  for (const [locale, catalog] of [
    ["fr", fr],
    ["en", en],
  ] as const) {
    it(`${locale} covers every contracts warning code`, () => {
      const warnings = catalog.warnings as Record<string, string>;
      const missing = COMMAND_WARNING_CODES.filter(
        (code) => typeof warnings[code] !== "string" || warnings[code].length === 0,
      );
      expect(missing).toEqual([]);
    });
  }
});
