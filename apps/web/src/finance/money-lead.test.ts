import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../i18n/index.js";
import { moneyLead, moneyMonthName } from "./money-lead.js";

const lead = (
  lng: "en" | "fr-CM",
  unlockedPeriodCodes: string[],
  lastLockedPeriodCode: string | null,
  ownOnly = false,
) =>
  moneyLead(
    i18n.getFixedT(lng),
    { month: "2026-10", unlockedPeriodCodes, lastLockedPeriodCode },
    { ownOnly, locale: lng },
  );

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

// #526: the lead says which months are not locked yet and which month the
// tiles count, the workspace's current one; it never calls one month "open".
describe("the Money lead", () => {
  it("names the month left unlocked and the month the tiles show", () => {
    expect(lead("en", ["2026-09"], "2026-08")).toBe(
      "Every expense and revenue. September isn't locked yet. Tiles show October.",
    );
    expect(lead("fr-CM", ["2026-09"], "2026-08")).toBe(
      "Toutes les dépenses et recettes. Septembre n'est pas encore clôturé. Les totaux portent sur octobre.",
    );
  });

  it("names every month left unlocked, not only the latest", () => {
    expect(lead("en", ["2026-07", "2026-09"], "2026-08")).toBe(
      "Every expense and revenue. July and September aren't locked yet. Tiles show October.",
    );
    expect(lead("fr-CM", ["2026-07", "2026-09"], "2026-08")).toBe(
      "Toutes les dépenses et recettes. Juillet et septembre ne sont pas encore clôturés. Les totaux portent sur octobre.",
    );
  });

  it("counts a long run of unlocked months from the oldest", () => {
    const months = ["2025-12", "2026-01", "2026-02", "2026-03"];
    expect(lead("en", months, null)).toBe(
      "Every expense and revenue. 4 months aren't locked yet, starting with December 2025. Tiles show October.",
    );
    expect(lead("fr-CM", months, null)).toBe(
      "Toutes les dépenses et recettes. 4 mois ne sont pas encore clôturés, à partir de décembre 2025. Les totaux portent sur octobre.",
    );
  });

  it("names the last locked month when every earlier month is locked", () => {
    expect(lead("en", [], "2026-09")).toBe("Every expense and revenue. September is locked. Tiles show October.");
    expect(lead("fr-CM", [], "2026-09")).toBe(
      "Toutes les dépenses et recettes. Septembre est clôturé. Les totaux portent sur octobre.",
    );
  });

  it("names only the tiles' month when no month was ever locked or left open", () => {
    expect(lead("en", [], null)).toBe("Every expense and revenue. Tiles show October.");
    expect(lead("fr-CM", [], null)).toBe("Toutes les dépenses et recettes. Les totaux portent sur octobre.");
  });

  // #619, #645: a driver's page holds only their own expenses; the lead says so, once.
  it("tells a driver the page holds their expenses", () => {
    expect(lead("en", ["2026-09"], null, true)).toBe(
      "Your expenses. September isn't locked yet. Tiles show October.",
    );
    expect(lead("en", [], "2026-09", true)).toBe("Your expenses. September is locked. Tiles show October.");
    expect(lead("en", [], null, true)).toBe("Your expenses. Tiles show October.");
    expect(lead("fr-CM", ["2026-07", "2026-09"], null, true)).toBe(
      "Vos dépenses. Juillet et septembre ne sont pas encore clôturés. Les totaux portent sur octobre.",
    );
  });
});

describe("a month's name on the Money page", () => {
  // The year is the workspace's current one, not the device's (#639).
  it("adds the year only outside the workspace's current year", () => {
    expect(moneyMonthName("2026-09", { locale: "en", currentMonth: "2026-10" })).toBe("September");
    expect(moneyMonthName("2025-12", { locale: "en", currentMonth: "2026-01" })).toBe("December 2025");
    expect(moneyMonthName("2026-01", { locale: "fr-CM", currentMonth: "2026-01", capitalize: true })).toBe("Janvier");
  });
});
