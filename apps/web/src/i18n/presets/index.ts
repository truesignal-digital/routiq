import type { TemplateCode } from "@routiq/contracts";
import passengerTransportEn from "./passenger-transport.en.json";
import passengerTransportFr from "./passenger-transport.fr.json";
import truckingEn from "./trucking.en.json";
import truckingFr from "./trucking.fr.json";

/**
 * A sparse overlay: the same nested shape as the base catalog, holding only the
 * keys whose wording changes. Every key must already exist in both base
 * catalogs — the overlay renames concepts, it never introduces messages.
 */
export type PresetOverlay = Record<string, unknown>;

export interface PresetVocabulary {
  fr: PresetOverlay;
  en: PresetOverlay;
}

/**
 * The keys a preset overlays in French only: their words agree with the trip
 * noun's gender (the base Activité is feminine, Trajet and Voyage masculine),
 * and English has nothing to change. Every other key is overlaid in both
 * languages or in neither (#143).
 */
export const FRENCH_AGREEMENT_KEYS: readonly string[] = [
  "activities.status.PLANNED",
  "activities.status.CLOSED",
  "activities.status.CANCELLED",
  "activities.state.closed",
  "activities.state.closedWithGaps",
  "activities.completeness.COMPLETE",
  "activities.completeness.COMPLETE_WITH_EXCEPTIONS",
  "activities.detail.closedAt",
  "vehicle.trips.gapsNote",
];

/** Preset-level terminology overlays (ADR-0004: terminology is preset-level). */
export const PRESET_VOCABULARIES: Record<TemplateCode, PresetVocabulary> = {
  TRUCKING: { fr: truckingFr, en: truckingEn },
  PASSENGER_TRANSPORT: { fr: passengerTransportFr, en: passengerTransportEn },
};
