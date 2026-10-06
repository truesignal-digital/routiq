import i18next from "i18next";
import ICU from "i18next-icu";
import { describe, expect, it } from "vitest";
import type { TemplateCode } from "@routiq/contracts";
import { TEMPLATE_CODES } from "@routiq/contracts";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import { PRESET_VOCABULARIES } from "./presets/index.js";
import { applyPresetVocabulary, presetVocabularyFor } from "./preset-overlay.js";

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) {
      return flattenKeys(value as Record<string, unknown>, path);
    }
    return [path];
  });
}

function at(catalog: Record<string, unknown>, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (acc, part) => (acc === undefined ? undefined : (acc as Record<string, unknown>)[part]),
      catalog,
    );
}

const LOCALES = ["fr", "en"] as const;
const BASE = { fr, en } as const;

/** A throwaway instance: the app-wide singleton must not bleed across files. */
function freshInstance() {
  const instance = i18next.createInstance();
  void instance.use(ICU).init({
    lng: "fr-CM",
    fallbackLng: ["fr", "en"],
    resources: {
      fr: { translation: structuredClone(fr) },
      en: { translation: structuredClone(en) },
    },
    interpolation: { escapeValue: false },
    i18nFormat: { bindI18nStore: "added" },
  });
  return instance;
}

describe("preset overlays", () => {
  for (const preset of TEMPLATE_CODES) {
    describe(preset, () => {
      const overlay = PRESET_VOCABULARIES[preset];

      for (const locale of LOCALES) {
        it(`${locale}: every key exists in both base catalogs`, () => {
          for (const key of flattenKeys(overlay[locale])) {
            expect(at(fr, key), `${key} missing from base fr.json`).toBeTypeOf("string");
            expect(at(en, key), `${key} missing from base en.json`).toBeTypeOf("string");
          }
        });

        it(`${locale}: no message is empty`, () => {
          for (const key of flattenKeys(overlay[locale])) {
            expect(at(overlay[locale], key), key).toBeTruthy();
          }
        });

        it(`${locale}: no entry repeats the base wording`, () => {
          for (const key of flattenKeys(overlay[locale])) {
            expect(at(overlay[locale], key), `${key} is a no-op overlay entry`).not.toEqual(
              at(BASE[locale], key),
            );
          }
        });
      }

      it("fr and en overlay the same keys", () => {
        expect(flattenKeys(overlay.en).sort()).toEqual(flattenKeys(overlay.fr).sort());
      });

      // An activity renamed to whatever French calls a leg would leave one
      // noun for two nested concepts — the reason the base catalog moved legs
      // from "trajet" to "étape". English is safe (Leg vs Trip), so this only
      // guards fr, and it reads the base leg labels so it follows a rename.
      it("fr: does not rename an activity to the base word for a leg", () => {
        const legLabels = new Set(
          ["activities.detail.legs", "activities.columns.legs"].map((key) => at(fr, key)),
        );
        for (const key of ["nav.activities", "activities.title"]) {
          const renamed = at(overlay.fr, key);
          if (renamed === undefined) continue;
          expect(legLabels.has(renamed), `${key} collides with the base leg label`).toBe(false);
        }
      });
    });
  }
});

// The base catalog says "activité"/"activity"; each preset brings its own trip
// noun. A base string that names the trip itself shows one fleet the other's word.
const TRIP_NOUN = /\b(trajets?|voyages?|trips?|journeys?)\b/i;

describe("trip noun in the base catalog", () => {
  for (const locale of LOCALES) {
    it(`${locale}: every base string naming the trip is overlaid by every preset`, () => {
      const offenders = flattenKeys(BASE[locale])
        .filter((key) => TRIP_NOUN.test(String(at(BASE[locale], key))))
        .flatMap((key) =>
          TEMPLATE_CODES.filter(
            (preset) => at(PRESET_VOCABULARIES[preset][locale], key) === undefined,
          ).map((preset) => `${key} (${preset})`),
        );
      expect(offenders).toEqual([]);
    });
  }

  // The test above can't see a base string that slides back to "trip" once
  // every preset overlays it, yet a mixed fleet reads the base. The trip's own
  // sections therefore stay neutral in the base catalog, overlaid or not.
  const NEUTRAL_SECTIONS = ["activities.", "vehicle."];
  // ICU select and plural case keys (`trip {Back to the activity}`) are code,
  // not words on screen; a placeholder (`Trip {number}`) is not a case key.
  const withoutCaseKeys = (message: string) => message.replace(/\b\w+\s*\{(?!\s*\w+\s*[,}])/g, "{");

  it("ignores ICU case keys but not a noun before a placeholder", () => {
    expect(TRIP_NOUN.test(withoutCaseKeys("{kind, select, trip {Back to the activity} other {Back}}"))).toBe(false);
    expect(TRIP_NOUN.test(withoutCaseKeys("Trip {number} · {type}"))).toBe(true);
    expect(TRIP_NOUN.test(withoutCaseKeys("{count, plural, one {# trip} other {# trips}}"))).toBe(true);
  });

  for (const locale of LOCALES) {
    it(`${locale}: activity and vehicle strings in the base catalog never name the trip`, () => {
      const offenders = flattenKeys(BASE[locale])
        .filter((key) => NEUTRAL_SECTIONS.some((section) => key.startsWith(section)))
        .filter((key) => TRIP_NOUN.test(withoutCaseKeys(String(at(BASE[locale], key)))))
        .map((key) => `${key}: ${String(at(BASE[locale], key))}`);
      expect(offenders).toEqual([]);
    });
  }

  // French has a word per fleet, so an overlay copied from the other preset
  // shows up as the other fleet's noun.
  const FOREIGN_TRIP_NOUN: Record<TemplateCode, RegExp> = {
    TRUCKING: /\bvoyages?\b/i,
    PASSENGER_TRANSPORT: /\btrajets?\b/i,
  };
  for (const preset of TEMPLATE_CODES) {
    it(`fr: the ${preset} overlay never names the other fleet's trip`, () => {
      const overlay = PRESET_VOCABULARIES[preset].fr;
      const offenders = flattenKeys(overlay).filter((key) =>
        FOREIGN_TRIP_NOUN[preset].test(String(at(overlay, key))),
      );
      expect(offenders).toEqual([]);
    });
  }
});

describe("presetVocabularyFor", () => {
  it("returns nothing while /v1/me is loading", () => {
    expect(presetVocabularyFor(undefined)).toBeUndefined();
  });

  it("returns nothing for a workspace with no preset", () => {
    expect(presetVocabularyFor([])).toBeUndefined();
  });

  it("returns the only enabled preset", () => {
    expect(presetVocabularyFor(["TRUCKING"])).toBe("TRUCKING");
    expect(presetVocabularyFor(["PASSENGER_TRANSPORT"])).toBe("PASSENGER_TRANSPORT");
  });

  it("keeps the base vocabulary for a mixed fleet", () => {
    expect(presetVocabularyFor(["TRUCKING", "PASSENGER_TRANSPORT"])).toBeUndefined();
  });
});

describe("applyPresetVocabulary", () => {
  it("renames the chrome of a single-preset workspace", () => {
    const instance = freshInstance();

    applyPresetVocabulary(instance, presetVocabularyFor(["TRUCKING"]));
    expect(instance.t("nav.assets")).toBe("Camions");
    expect(instance.t("activities.title")).toBe("Trajets");

    applyPresetVocabulary(instance, presetVocabularyFor(["PASSENGER_TRANSPORT"]));
    expect(instance.t("nav.assets")).toBe("Véhicules");
    expect(instance.t("activities.columns.primaryAsset")).toBe("Véhicule principal");
  });

  it("names the trip in each fleet's own word in the money card's scope sentences", () => {
    const instance = freshInstance();

    for (const [preset, word] of [
      ["TRUCKING", "ce trajet"],
      ["PASSENGER_TRANSPORT", "ce voyage"],
    ] as const) {
      applyPresetVocabulary(instance, presetVocabularyFor([preset]));
      expect(instance.t("activities.detail.moneySummary.ownOnly", { lng: "fr" }), preset).toContain(word);
      expect(instance.t("activities.detail.moneySummary.branchOnly", { lng: "fr" }), preset).toContain(word);
      expect(instance.t("activities.detail.moneySummary.ownOnly", { lng: "en" }), preset).toContain("this trip");
    }
  });

  it("names the trip in each fleet's own word on the trip sheet", () => {
    const instance = freshInstance();

    // A mixed fleet sees the sheet-type tabs and the base words, so neither
    // may borrow one preset's trip noun.
    for (const lng of LOCALES) {
      for (const key of [
        "activities.record.subtitle",
        "assets.form.templates.PASSENGER_TRANSPORT",
        "assets.form.templates.TRUCKING",
        "activities.record.entries.attributeHint",
      ]) {
        expect(instance.t(key, { lng }), `${key} ${lng}`).not.toMatch(TRIP_NOUN);
      }
    }
    expect(instance.t("assets.form.templates.PASSENGER_TRANSPORT", { lng: "fr" })).toBe(
      "Transport de voyageurs",
    );

    for (const [preset, word] of [
      ["TRUCKING", "non au trajet"],
      ["PASSENGER_TRANSPORT", "non au voyage"],
    ] as const) {
      applyPresetVocabulary(instance, preset);
      expect(instance.t("activities.record.entries.attributeHint", { lng: "fr" }), preset).toContain(word);
      expect(instance.t("activities.record.entries.attributeHint", { lng: "en" }), preset).toContain(
        "rather than the trip",
      );
    }
  });

  it("names the trip in each fleet's own word in the vehicle workspace", () => {
    const instance = freshInstance();
    const trip = (lng: "fr" | "en") => ({
      tab: instance.t("vehicle.tabs.trips", { lng }),
      description: instance.t("vehicle.trips.description", { lng }),
      row: instance.t("vehicle.trips.tripNumber", { number: 12, lng }),
      open: instance.t("vehicle.trips.openFull", { lng }),
    });

    expect(trip("fr")).toEqual({
      tab: "Activités",
      description: "Activités avec ce véhicule",
      row: "Activité 12",
      open: "Ouvrir l'activité complète",
    });
    expect(trip("en").row).toBe("Activity 12");

    applyPresetVocabulary(instance, "TRUCKING");
    expect(trip("fr")).toEqual({
      tab: "Trajets",
      description: "Trajets avec ce camion",
      row: "Trajet 12",
      open: "Ouvrir le trajet complet",
    });
    expect(trip("en").row).toBe("Trip 12");

    applyPresetVocabulary(instance, "PASSENGER_TRANSPORT");
    expect(trip("fr")).toEqual({
      tab: "Voyages",
      description: "Voyages avec ce véhicule",
      row: "Voyage 12",
      open: "Ouvrir le voyage complet",
    });
    expect(trip("en").row).toBe("Trip 12");
  });

  it("keeps the branch-empty hint in each fleet's own word for a vehicle", () => {
    const instance = freshInstance();

    // The base catalog had leaked "véhicule" here while every other base asset
    // string said "actif", which left passenger transport nothing to overlay.
    expect(instance.t("assets.branchEmptyHint")).toBe(
      "Aucun actif n'est rattaché à cette agence.",
    );

    applyPresetVocabulary(instance, "TRUCKING");
    expect(instance.t("assets.branchEmptyHint")).toBe(
      "Aucun camion n'est rattaché à cette agence.",
    );

    applyPresetVocabulary(instance, "PASSENGER_TRANSPORT");
    expect(instance.t("assets.branchEmptyHint")).toBe(
      "Aucun véhicule n'est rattaché à cette agence.",
    );
  });

  it("renames the vehicle inside the workshop too", () => {
    const instance = freshInstance();

    expect(instance.t("maintenance.fields.asset")).toBe("Actif");

    applyPresetVocabulary(instance, "TRUCKING");
    expect(instance.t("maintenance.fields.asset")).toBe("Camion");
    expect(instance.t("maintenance.detail.unavailableTitle")).toBe("Camion immobilisé");

    applyPresetVocabulary(instance, "PASSENGER_TRANSPORT");
    expect(instance.t("maintenance.workOrders.columns.asset")).toBe("Véhicule");
    expect(instance.t("maintenance.notify.success.assetReleased")).toBe(
      "Véhicule remis en service",
    );
  });

  // The work-order sheet reads its timeline labels out of `history.event.*`,
  // so an unrenamed event would contradict the columns beside it.
  it("renames the vehicle in the chronologie's shared event labels", () => {
    const instance = freshInstance();

    applyPresetVocabulary(instance, "TRUCKING");
    expect(instance.t("history.event.work_order-asset_released")).toBe(
      "Camion remis en service",
    );

    applyPresetVocabulary(instance, "PASSENGER_TRANSPORT");
    expect(instance.t("history.event.asset_availability-opened")).toBe(
      "Véhicule immobilisé",
    );
  });

  // The sheet's title is its breadcrumb and the Trips button, and its submit
  // says "la fiche": renaming only the title would leave the page disagreeing.
  it("keeps the trip sheet's title in step with its submit in every preset", () => {
    const instance = freshInstance();

    for (const preset of TEMPLATE_CODES) {
      applyPresetVocabulary(instance, preset);
      for (const [lng, title, submit] of [
        ["fr", "Saisir une fiche", "Enregistrer la fiche"],
        ["en", "Record a sheet", "Record sheet"],
      ] as const) {
        expect(instance.t("commands.record-journey-sheet.label", { lng }), `${preset} ${lng}`).toBe(title);
        expect(instance.t("commands.record-journey-sheet.submit", { lng }), `${preset} ${lng}`).toBe(submit);
      }
    }
  });

  it("leaves a mixed fleet on the base vocabulary", () => {
    const instance = freshInstance();

    applyPresetVocabulary(instance, presetVocabularyFor(["TRUCKING", "PASSENGER_TRANSPORT"]));
    expect(instance.t("nav.assets")).toBe("Actifs");
    expect(instance.t("activities.title")).toBe("Activités");
  });

  it("restores the base vocabulary when the overlay is cleared", () => {
    const instance = freshInstance();

    applyPresetVocabulary(instance, "TRUCKING");
    applyPresetVocabulary(instance, undefined);

    expect(instance.t("nav.assets")).toBe("Actifs");
    expect(instance.t("commands.register-asset.submit")).toBe("Enregistrer l'actif");
  });

  it("survives a language switch", async () => {
    const instance = freshInstance();
    applyPresetVocabulary(instance, "PASSENGER_TRANSPORT");

    await instance.changeLanguage("en");
    expect(instance.t("nav.assets")).toBe("Vehicles");
    expect(instance.t("activities.title")).toBe("Trips");
  });

  it("keeps ICU placeholders intact", () => {
    const instance = freshInstance();
    applyPresetVocabulary(instance, "TRUCKING");

    expect(instance.t("home.cards.assets.description", { count: 3 })).toBe(
      "sur 3 camions enregistrés",
    );
    expect(instance.t("activities.record.entries.rowAttribute", { position: 2 })).toBe(
      "Imputer la ligne 2 à ce trajet",
    );
    expect(instance.t("activities.actions.addLegHint", { legNo: 3 })).toBe(
      "Étape n° 3 de ce trajet.",
    );
  });

  it("covers every preset code", () => {
    expect(Object.keys(PRESET_VOCABULARIES).sort()).toEqual(
      ([...TEMPLATE_CODES] as TemplateCode[]).sort(),
    );
  });
});
