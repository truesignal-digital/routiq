import { afterAll, describe, expect, it } from "vitest";
import { i18n } from "./index.js";

const locales = [
  ["en", "3 entries", "+2 pending in other branches"],
  ["fr", "3 écritures", "+2 en attente dans d'autres agences"],
] as const;

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

describe("ICU interpolation", () => {
  it("renders finance.periods.entryCount with count=3", async () => {
    for (const [locale, expected] of locales) {
      await i18n.changeLanguage(locale);
      const output = i18n.t("finance.periods.entryCount", { count: 3 });

      expect(output).toBe(expected);
      expect(output).not.toContain("{{");
      expect(output).not.toContain("}}");
    }
  });

  it("renders finance.approvals.outsideBranch with count=2", async () => {
    for (const [locale, , expected] of locales) {
      await i18n.changeLanguage(locale);
      const output = i18n.t("finance.approvals.outsideBranch", { count: 2 });

      expect(output).toBe(expected);
      expect(output).not.toContain("{{");
      expect(output).not.toContain("}}");
    }
  });
});
