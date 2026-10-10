import type { FormSectionState } from "@/components/form-page.js";
import { parseMoneyXaf } from "@/lib/format.js";
import {
  endpointText,
  isBlankCrew,
  isBlankEntry,
  isBlankLeg,
  isBlankSegment,
  type SheetFormValues,
} from "./form.js";

/** The sheet's sections, top to bottom, as Record a sheet lays them out. */
export const SHEET_SECTIONS = ["references", "vehicle", "crew", "legs", "flavour", "money"] as const;
export type SheetSectionId = (typeof SHEET_SECTIONS)[number];

/** The form fields each section holds, for "Still missing" links and a phone's error step. */
export const SHEET_SECTION_FIELDS: Readonly<Record<SheetSectionId, readonly string[]>> = {
  references: ["template", "branchCode", "activityTypeCode", "customerName", "clientReference", "description"],
  vehicle: ["primaryAssetId", "startedAt", "endedAt", "startReading", "endReading", "extraSegments"],
  crew: ["crew"],
  legs: ["legs"],
  flavour: ["seatsSold", "seatsAvailable", "cargoDescription", "cargoWeightKg"],
  money: ["entries"],
};

/** The fields a sheet cannot be recorded without, in the order the sheet asks for them. */
export const SHEET_REQUIRED = ["branchCode", "activityTypeCode", "primaryAssetId", "startedAt", "endedAt"] as const;
export type SheetRequiredField = (typeof SHEET_REQUIRED)[number];

const REQUIRED_IN: Readonly<Record<SheetSectionId, readonly SheetRequiredField[]>> = {
  references: ["branchCode", "activityTypeCode"],
  vehicle: ["primaryAssetId", "startedAt", "endedAt"],
  crew: [],
  legs: [],
  flavour: [],
  money: [],
};

const filled = (text: string) => text.trim() !== "";

export function missingRequired(values: SheetFormValues): SheetRequiredField[] {
  return SHEET_REQUIRED.filter((field) => !filled(values[field]));
}

/**
 * What a started row still lacks: an untouched row is dropped at submit, a
 * half-filled one is refused until these are given (the sheet's own rules).
 */
export type SheetRowGap =
  | { field: `legs.${number}.origin` | `legs.${number}.destination`; kind: "origin" | "destination"; position: number }
  | { field: `entries.${number}.categoryCode` | `entries.${number}.amount`; kind: "category" | "amount"; position: number };

export function missingInRows(values: SheetFormValues): SheetRowGap[] {
  const gaps: SheetRowGap[] = [];
  values.legs.forEach((row, index) => {
    if (isBlankLeg(row)) return;
    const position = index + 1;
    if (!filled(endpointText(row.origin))) gaps.push({ field: `legs.${index}.origin`, kind: "origin", position });
    if (!filled(endpointText(row.destination))) {
      gaps.push({ field: `legs.${index}.destination`, kind: "destination", position });
    }
  });
  values.entries.forEach((row, index) => {
    if (isBlankEntry(row)) return;
    const position = index + 1;
    if (row.categoryCode === "") gaps.push({ field: `entries.${index}.categoryCode`, kind: "category", position });
    const amount = parseMoneyXaf(row.amount);
    if (amount === null || amount <= 0) gaps.push({ field: `entries.${index}.amount`, kind: "amount", position });
  });
  return gaps;
}

/** What each section has: its required fields still empty, and whether anything in it was entered. */
export function sheetSectionStates(values: SheetFormValues): Record<SheetSectionId, FormSectionState> {
  const missing = new Set(missingRequired(values));
  const gaps = missingInRows(values);
  const count = (section: SheetSectionId) => REQUIRED_IN[section].filter((field) => missing.has(field)).length;
  const gapsIn = (prefix: string) => gaps.filter((gap) => gap.field.startsWith(`${prefix}.`)).length;
  return {
    references: {
      missing: count("references"),
      started: [
        values.branchCode,
        values.activityTypeCode,
        values.customerName,
        values.clientReference,
        values.description,
      ].some(filled),
    },
    vehicle: {
      missing: count("vehicle"),
      started:
        [values.primaryAssetId, values.startedAt, values.endedAt, values.startReading.value, values.endReading.value].some(
          filled,
        ) || values.extraSegments.some((row) => !isBlankSegment(row)),
    },
    crew: { missing: 0, started: values.crew.some((row) => !isBlankCrew(row)) },
    legs: { missing: gapsIn("legs"), started: values.legs.some((row) => !isBlankLeg(row)) },
    flavour: {
      missing: 0,
      started: [values.seatsSold, values.seatsAvailable, values.cargoDescription, values.cargoWeightKg].some(filled),
    },
    money: { missing: gapsIn("entries"), started: values.entries.some((row) => !isBlankEntry(row)) },
  };
}

function wholeNumber(text: string): number | undefined {
  const trimmed = text.replace(/\s/g, "");
  return /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : undefined;
}

export interface SheetTotals {
  /** Where the first leg starts and the last one ends; absent when no leg names them. */
  from?: string;
  to?: string;
  /** The legs' distances added up; absent when no leg gives one. */
  distanceKm?: number;
  /** Revenue and expense lines charged to this trip; absent when there is none. */
  revenue?: number;
  expenses?: number;
}

/**
 * The trip's figures as the sheet says them so far. A line the clerk kept off
 * the trip (a repair to the truck) is not the trip's money and is left out;
 * nothing missing is counted as zero.
 */
export function sheetTotals(values: SheetFormValues): SheetTotals {
  const totals: SheetTotals = {};
  const legs = values.legs.filter((row) => !isBlankLeg(row));
  const from = legs.map((row) => endpointText(row.origin).trim()).find(filled);
  const to = legs.map((row) => endpointText(row.destination).trim()).findLast(filled);
  if (from !== undefined) totals.from = from;
  if (to !== undefined) totals.to = to;

  const distances = legs.map((row) => wholeNumber(row.distanceKm)).filter((km) => km !== undefined);
  if (distances.length > 0) totals.distanceKm = distances.reduce((sum, km) => sum + km, 0);

  for (const row of values.entries) {
    if (isBlankEntry(row) || !row.attributeToActivity) continue;
    const amount = parseMoneyXaf(row.amount);
    if (amount === null || amount <= 0) continue;
    if (row.direction === "REVENUE") totals.revenue = (totals.revenue ?? 0) + amount;
    else totals.expenses = (totals.expenses ?? 0) + amount;
  }
  return totals;
}
