/**
 * The UI language is a device preference, like the theme: it lives in
 * localStorage, is read before the first render, and never travels through a
 * command. fr-CM is the default; only an explicit choice on My settings changes it.
 */
export const LANGUAGE_STORAGE_KEY = "routiq-language";

export const appLanguages = ["fr-CM", "en"] as const;
export type AppLanguage = (typeof appLanguages)[number];

export const DEFAULT_LANGUAGE: AppLanguage = "fr-CM";

export function isAppLanguage(value: unknown): value is AppLanguage {
  return appLanguages.some((language) => language === value);
}

/** Storage access throws in private-mode browsers, so every read is guarded. */
export function readStoredLanguage(): AppLanguage {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isAppLanguage(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/** The user's pick on My settings: remembered for the next load, then applied. */
export function chooseLanguage(
  i18n: { changeLanguage: (language: string) => Promise<unknown> },
  language: AppLanguage,
): Promise<unknown> {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // A device that refuses storage still gets the language for this session.
  }
  return i18n.changeLanguage(language);
}
