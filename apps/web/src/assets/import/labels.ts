import type { i18n as I18n } from "i18next";
import { TEMPLATE_CODES, type TemplateCode } from "@routiq/contracts";
import en from "@/i18n/locales/en.json";
import fr from "@/i18n/locales/fr.json";
import { allImportFields, fieldLabelKey, normalizeLabel, type ImportContext, type ImportField } from "./model.js";

const LANGUAGES = ["fr", "en"] as const;

/**
 * Every wording a header may come in: both languages, with and without the
 * preset vocabulary ("Code du camion" and "Code de l'actif"), so a template
 * downloaded by a colleague in the other language or preset still reads.
 */
export function headerLabels(i18n: I18n): Map<string, ImportField> {
  const labels = new Map<string, ImportField>();
  for (const field of allImportFields()) {
    for (const text of wordings(i18n, fieldLabelKey(field))) labels.set(normalizeLabel(text), field);
  }
  return labels;
}

export function choiceLabels(i18n: I18n): Pick<ImportContext, "templateLabels" | "unitLabels"> {
  const templateLabels = Object.fromEntries(
    TEMPLATE_CODES.map((code) => [code, wordings(i18n, `assets.form.templates.${code}`)]),
  ) as Record<TemplateCode, string[]>;
  const unitLabels = {
    KG: wordings(i18n, "assets.form.units.KG"),
    TONNE: wordings(i18n, "assets.form.units.TONNE"),
    M3: wordings(i18n, "assets.form.units.M3"),
    SEAT: wordings(i18n, "assets.form.units.SEAT"),
  };
  return { templateLabels, unitLabels };
}

function wordings(i18n: I18n, key: string): string[] {
  const texts = LANGUAGES.flatMap((lng) => [i18n.getFixedT(lng)(key), lookup(lng === "fr" ? fr : en, key)]);
  return [...new Set(texts.filter((text): text is string => typeof text === "string" && text !== key))];
}

function lookup(catalog: unknown, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}
