import {
  AUTH_ERROR_CODES,
  COMMAND_ERROR_CODES,
  VALIDATION_ERROR_CODES,
} from "@routiq/contracts";
import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

// Client-side codes that never come from the API registry.
const CLIENT_CODES = ["NETWORK_ERROR", "READ_FAILED", "generic"] as const;

const ALL_CODES = [
  ...AUTH_ERROR_CODES,
  ...VALIDATION_ERROR_CODES,
  ...COMMAND_ERROR_CODES,
  ...CLIENT_CODES,
];

describe("error map completeness", () => {
  for (const [locale, catalog] of [
    ["fr", fr],
    ["en", en],
  ] as const) {
    it(`${locale} covers every contracts error code`, () => {
      const errors = catalog.errors as Record<string, string>;
      const missing = ALL_CODES.filter(
        (code) => typeof errors[code] !== "string" || errors[code].length === 0,
      );
      expect(missing).toEqual([]);
    });
  }
});
