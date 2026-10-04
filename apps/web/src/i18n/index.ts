import i18next, { type i18n as I18n } from "i18next";
import { z } from "zod";
import { makeZodErrorMap } from "./zod-error-map.js";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import { readStoredLanguage } from "./language.js";

export const i18n: I18n = i18next.createInstance();

// Registered before init: with inline resources init switches to the start
// language synchronously, and the page lang and Zod locale must follow it.
i18n.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng;
  }
  // Zod powers client-side form validation — its messages follow the app locale.
  z.config(lng.startsWith("en") ? z.locales.en() : z.locales.fr());
});

void i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    lng: readStoredLanguage(),
    fallbackLng: ["fr", "en"],
    resources: {
      // Cloned: the store keeps the object it is handed, and preset overlays
      // merge into it — the imported catalogs must stay the pristine base.
      fr: { translation: structuredClone(fr) },
      en: { translation: structuredClone(en) },
    },
    interpolation: {
      // React already escapes rendered strings.
      escapeValue: false,
    },
    react: {
      // Preset terminology overlays land as resource-bundle writes after the
      // first render; without this react-i18next ignores store mutations.
      bindI18nStore: "added",
    },
    i18nFormat: {
      // i18next-icu memoizes compiled messages per lng.ns.key, so an overlay
      // would keep serving the pre-overlay wording until the cache is dropped.
      bindI18nStore: "added",
    },
  });

// Friendly overrides for the cases users actually hit; i18n.t resolves at
// validation time so messages follow the active language.
z.config({ customError: makeZodErrorMap((key, options) => i18n.t(key, options ?? {})) });
