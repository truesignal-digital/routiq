// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  chooseLanguage,
  readStoredLanguage,
} from "./language.js";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("readStoredLanguage", () => {
  it("is French on a first visit", () => {
    expect(DEFAULT_LANGUAGE).toBe("fr-CM");
    expect(readStoredLanguage()).toBe("fr-CM");
  });

  it("returns the stored choice", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
    expect(readStoredLanguage()).toBe("en");
  });

  it("falls back to French for a value the app does not offer", () => {
    for (const stored of ["de", "", "EN", "fr"]) {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, stored);
      expect(readStoredLanguage(), stored).toBe("fr-CM");
    }
  });

  it("falls back to French when storage refuses to be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readStoredLanguage()).toBe("fr-CM");
  });
});

describe("chooseLanguage", () => {
  it("stores the choice and switches the app", async () => {
    const changeLanguage = vi.fn(async () => undefined);
    await chooseLanguage({ changeLanguage }, "en");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");
    expect(changeLanguage).toHaveBeenCalledWith("en");
  });

  it("still switches when storage refuses the write", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const changeLanguage = vi.fn(async () => undefined);
    await chooseLanguage({ changeLanguage }, "en");
    expect(changeLanguage).toHaveBeenCalledWith("en");
  });
});

describe("app start", () => {
  it("opens in French with nothing stored", async () => {
    const { i18n } = await import("./index.js");
    expect(i18n.language).toBe("fr-CM");
    expect(document.documentElement.lang).toBe("fr-CM");
  });

  it("opens in the stored language, page lang included", async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
    const { i18n } = await import("./index.js");
    expect(i18n.language).toBe("en");
    expect(i18n.t("nav.home")).toBe("Home");
    expect(document.documentElement.lang).toBe("en");
  });
});
