import i18next, { type i18n as I18n } from "i18next";
import { z } from "zod";
import { makeZodErrorMap } from "./zod-error-map.js";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

export const i18n: I18n = i18next.createInstance();

void i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    lng: "fr-CM",
    fallbackLng: "fr",
    resources: {
      fr: { translation: fr },
      en: { translation: en },
    },
    interpolation: {
      // React already escapes rendered strings.
      escapeValue: false,
    },
  });

i18n.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng;
  }
  // Zod powers client-side form validation — its messages follow the app locale.
  z.config(lng.startsWith("en") ? z.locales.en() : z.locales.fr());
});

z.config(z.locales.fr());
// Friendly overrides for the cases users actually hit; i18n.t resolves at
// validation time so messages follow the active language.
z.config({ customError: makeZodErrorMap((key, options) => i18n.t(key, options ?? {})) });
