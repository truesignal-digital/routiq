import type { i18n as I18n } from "i18next";
import type { TemplateCode } from "@routiq/contracts";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import { PRESET_VOCABULARIES } from "./presets/index.js";

const NAMESPACE = "translation";

/**
 * i18next's resource store keeps whatever object it was handed, so an overlay
 * merge writes straight through into the imported catalog. These snapshots are
 * taken at module load, before any overlay can have been applied, and are the
 * only trustworthy copy of the base wording.
 */
const BASE = {
  fr: JSON.parse(JSON.stringify(fr)) as Record<string, unknown>,
  en: JSON.parse(JSON.stringify(en)) as Record<string, unknown>,
};

/**
 * The preset whose vocabulary the chrome should speak, or `undefined` for the
 * base wording. A workspace enables a SET of presets (ADR-0004); only a
 * single-preset workspace gets renamed chrome, because a mixed fleet must not
 * be told its buses are "Camions".
 */
export function presetVocabularyFor(
  enabledPresets: readonly TemplateCode[] | undefined,
): TemplateCode | undefined {
  if (enabledPresets === undefined || enabledPresets.length !== 1) return undefined;
  return enabledPresets[0];
}

/**
 * Swaps the active terminology overlay on the shared resource store.
 *
 * Both languages are overlaid up front so a language switch keeps the preset
 * vocabulary. Restoring the base catalog (rather than removing a bundle) is
 * what clears a previous overlay: the overlay shares the `translation`
 * namespace with the base catalog, and its keys are a strict subset of it, so
 * re-adding the base resets every overlaid string.
 */
export function applyPresetVocabulary(i18n: I18n, preset: TemplateCode | undefined): void {
  i18n.addResourceBundle("fr", NAMESPACE, BASE.fr, true, true);
  i18n.addResourceBundle("en", NAMESPACE, BASE.en, true, true);
  if (preset === undefined) return;

  const overlay = PRESET_VOCABULARIES[preset];
  i18n.addResourceBundle("fr", NAMESPACE, overlay.fr, true, true);
  i18n.addResourceBundle("en", NAMESPACE, overlay.en, true, true);
}
