import { z } from "zod";
import type {
  CommandResult,
  LegEndpoint,
  MeterReadingCapture,
  TemplateCode,
  recordHaulageJobSheetPayload,
  recordJourneySheetPayload,
} from "@routiq/contracts";
import { parseMoneyXaf } from "../finance/model.js";

export type JourneySheetPayload = z.infer<typeof recordJourneySheetPayload>;
export type HaulageSheetPayload = z.infer<typeof recordHaulageJobSheetPayload>;

export type SheetTemplate = "journey" | "haulage";

/**
 * Which preset each sheet flavour belongs to. Not a UI convention: the sheet
 * commands are per-preset on the server (`record-journey-sheet` IS
 * PASSENGER_TRANSPORT), and the dispatcher refuses one outside the workspace's
 * enabled set. Declared once here so no screen re-states the pairing.
 */
export const SHEET_TEMPLATE_PRESET: Record<SheetTemplate, TemplateCode> = {
  journey: "PASSENGER_TRANSPORT",
  haulage: "TRUCKING",
};

const SHEET_TEMPLATES: SheetTemplate[] = ["journey", "haulage"];

/**
 * The sheet flavours a workspace may actually record, in tab order. An
 * undefined set means `/v1/me` has not answered yet — offer both rather than
 * guess, since the server is the enforcement point either way and a
 * single-preset workspace collapses as soon as the answer lands.
 */
export function sheetTemplatesFor(
  enabledPresets: readonly TemplateCode[] | undefined,
): SheetTemplate[] {
  if (enabledPresets === undefined) return [...SHEET_TEMPLATES];
  return SHEET_TEMPLATES.filter((template) =>
    enabledPresets.includes(SHEET_TEMPLATE_PRESET[template]),
  );
}

export type SheetReadingType = "ODOMETER" | "HOURS";
export type SheetSegmentRole = "TRAILER" | "RECOVERY";
export type SheetCrewRole =
  | "DRIVER"
  | "CONDUCTOR"
  | "ASSISTANT"
  | "RELIEF"
  | "MECHANIC"
  | "OTHER";
export type SheetPaymentMethod = "CASH" | "MOMO" | "OM" | "BANK" | "OTHER";
export type SheetEntryDirection = "REVENUE" | "EXPENSE";
export type SheetLoadState = "LADEN" | "EMPTY" | "PARTIAL";

/** The contract's leg endpoint union, so the picker's output reaches the
 * payload untouched. */
export type SheetEndpointState = LegEndpoint;

export interface SheetReadingState {
  /** Raw input; blank means no reading was taken, never a reading of zero. */
  value: string;
  readingType: SheetReadingType;
}

export interface SheetSegmentRow {
  segmentId: string;
  assetId: string;
  role: SheetSegmentRole;
  /** Blank means the extra carrier ran the whole activity. */
  startedAt?: string;
  endedAt?: string;
}

export interface SheetCrewRow {
  activityPersonId: string;
  personId: string;
  role: SheetCrewRole;
}

export interface SheetLegRow {
  legId: string;
  /** Display order only — the payload renumbers from array position. */
  legNo: number;
  origin: SheetEndpointState;
  destination: SheetEndpointState;
  departedAt?: string;
  arrivedAt?: string;
  distanceKm?: string;
  passengerCount?: string;
  loadState?: SheetLoadState;
}

export interface SheetEntryRow {
  entryId: string;
  direction: SheetEntryDirection;
  categoryCode: string;
  amount: string;
  paymentMethod: SheetPaymentMethod;
  counterpartyName?: string;
  description?: string;
  reference?: string;
  assetId?: string;
  personId?: string;
  /** §3.4 inv. 7: a repair to the truck that failed stays off the trip. */
  attributeToActivity: boolean;
}

export interface SheetFormState {
  template: SheetTemplate;
  branchCode: string;
  activityTypeCode: string;
  customerName?: string;
  clientReference?: string;
  description?: string;
  primaryAssetId: string;
  /** `<input type="datetime-local">` values — no offset, see toLocalOffsetIso. */
  startedAt: string;
  endedAt: string;
  startReading?: SheetReadingState;
  endReading?: SheetReadingState;
  extraSegments: SheetSegmentRow[];
  crew: SheetCrewRow[];
  legs: SheetLegRow[];
  entries: SheetEntryRow[];
  seatsSold?: string;
  seatsAvailable?: string;
  cargoDescription?: string;
  cargoWeightKg?: string;
}

/**
 * The ids the form cannot derive from what the user typed. Minted once when the
 * sheet opens and never regenerated: a retry must re-post an identical payload,
 * or the intent cache mints a fresh envelope and the §5.3 replay guarantee is
 * gone.
 */
export interface SheetIds {
  activityId: string;
  primarySegmentId: string;
  startReadingId: string;
  endReadingId: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Give a `datetime-local` value the offset the contract requires
 * (`z.iso.datetime({ offset: true })`). The browser control yields wall-clock
 * time with no zone, and a sheet captured in Douala must not be read as UTC.
 *
 * `offsetMinutes` follows `Date.prototype.getTimezoneOffset`: minutes to ADD to
 * local time to reach UTC, so UTC+1 is **-60** — the inverse of the ISO suffix.
 * It is a parameter only so tests need not depend on the runner's zone.
 */
export function toLocalOffsetIso(
  datetimeLocal: string,
  offsetMinutes?: number,
): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?$/.exec(
    datetimeLocal,
  );
  if (match === null) return datetimeLocal;

  const datePart = match[1]!;
  const hoursMinutes = match[2]!;
  const seconds = match[3] ?? ":00";
  const resolved = offsetMinutes ?? localOffsetMinutes(datetimeLocal);
  const eastOfUtc = -resolved;
  const sign = eastOfUtc < 0 ? "-" : "+";
  const magnitude = Math.abs(eastOfUtc);

  return `${datePart}T${hoursMinutes}${seconds}${sign}${pad2(
    Math.floor(magnitude / 60),
  )}:${pad2(magnitude % 60)}`;
}

function localOffsetMinutes(datetimeLocal: string): number {
  const at = new Date(datetimeLocal);
  return Number.isNaN(at.getTime())
    ? new Date().getTimezoneOffset()
    : at.getTimezoneOffset();
}

/** Blank stays blank: an empty count is "not captured", never zero. */
function parseCount(input: string | undefined): number | undefined {
  if (input === undefined) return undefined;
  const trimmed = input.replace(/\s/g, "");
  if (trimmed === "" || !/^\d+$/.test(trimmed)) return undefined;
  return Number.parseInt(trimmed, 10);
}

/** An untouched text field is absent from the payload, not an empty string. */
function text(input: string | undefined): string | undefined {
  return input === undefined || input.trim() === "" ? undefined : input;
}

function toReading(
  readingId: string,
  reading: SheetReadingState | undefined,
  observedAtLocal: string,
  offsetMinutes?: number,
): MeterReadingCapture | undefined {
  if (reading === undefined) return undefined;
  const value = parseCount(reading.value);
  if (value === undefined) return undefined;
  return {
    readingId,
    readingType: reading.readingType,
    value,
    observedAt: toLocalOffsetIso(observedAtLocal, offsetMinutes),
  };
}

/**
 * Everything both flavours share. One function rather than two copies: the
 * flavour difference is seats versus cargo, and nothing else about a sheet
 * changes with it.
 */
function toSheetBase(
  state: SheetFormState,
  ids: SheetIds,
  offsetMinutes?: number,
): Omit<JourneySheetPayload, "seatsSold" | "seatsAvailable"> {
  const startedAt = toLocalOffsetIso(state.startedAt, offsetMinutes);
  const endedAt = toLocalOffsetIso(state.endedAt, offsetMinutes);
  const startReading = toReading(
    ids.startReadingId,
    state.startReading,
    state.startedAt,
    offsetMinutes,
  );
  const endReading = toReading(
    ids.endReadingId,
    state.endReading,
    state.endedAt,
    offsetMinutes,
  );
  // One trip, one economic date: the day it started, read off the local
  // wall-clock string so a late-evening departure is not pushed to tomorrow.
  const economicDate = state.startedAt.slice(0, 10);

  const customerName = text(state.customerName);
  const clientReference = text(state.clientReference);
  const description = text(state.description);

  return {
    activityId: ids.activityId,
    branchCode: state.branchCode,
    activityTypeCode: state.activityTypeCode,
    primarySegmentId: ids.primarySegmentId,
    primaryAssetId: state.primaryAssetId,
    startedAt,
    endedAt,
    ...(startReading === undefined ? {} : { startReading }),
    ...(endReading === undefined ? {} : { endReading }),
    crew: state.crew.map((row) => ({
      activityPersonId: row.activityPersonId,
      personId: row.personId,
      role: row.role,
    })),
    legs: state.legs.map((row, index) => {
      const distanceKm = parseCount(row.distanceKm);
      const passengerCount = parseCount(row.passengerCount);
      return {
        legId: row.legId,
        legNo: index + 1,
        origin: row.origin,
        destination: row.destination,
        ...(row.departedAt
          ? { departedAt: toLocalOffsetIso(row.departedAt, offsetMinutes) }
          : {}),
        ...(row.arrivedAt
          ? { arrivedAt: toLocalOffsetIso(row.arrivedAt, offsetMinutes) }
          : {}),
        ...(distanceKm === undefined ? {} : { distanceKm }),
        ...(passengerCount === undefined ? {} : { passengerCount }),
        ...(row.loadState === undefined ? {} : { loadState: row.loadState }),
      };
    }),
    extraSegments: state.extraSegments.map((row) => ({
      segmentId: row.segmentId,
      assetId: row.assetId,
      role: row.role,
      // An extra carrier with no times of its own ran the whole activity.
      startedAt: row.startedAt
        ? toLocalOffsetIso(row.startedAt, offsetMinutes)
        : startedAt,
      ...(row.endedAt
        ? { endedAt: toLocalOffsetIso(row.endedAt, offsetMinutes) }
        : {}),
    })),
    entries: state.entries.map((row) => {
      const paymentReference = text(row.reference);
      const entryDescription = text(row.description);
      const counterpartyName = text(row.counterpartyName);
      return {
        entryId: row.entryId,
        direction: row.direction,
        categoryCode: row.categoryCode,
        amountMinor: parseMoneyXaf(row.amount) ?? 0,
        economicDate,
        paymentMethod: row.paymentMethod,
        ...(paymentReference === undefined ? {} : { paymentReference }),
        ...(entryDescription === undefined ? {} : { description: entryDescription }),
        ...(counterpartyName === undefined ? {} : { counterpartyName }),
        ...(row.assetId ? { assetId: row.assetId } : {}),
        ...(row.personId ? { personId: row.personId } : {}),
        attributeToActivity: row.attributeToActivity,
      };
    }),
    ...(customerName === undefined ? {} : { customerName }),
    ...(clientReference === undefined ? {} : { clientReference }),
    ...(description === undefined ? {} : { description }),
    customValues: {},
  };
}

export function toJourneySheetPayload(
  state: SheetFormState,
  ids: SheetIds,
  offsetMinutes?: number,
): JourneySheetPayload {
  const seatsSold = parseCount(state.seatsSold);
  const seatsAvailable = parseCount(state.seatsAvailable);
  return {
    ...toSheetBase(state, ids, offsetMinutes),
    ...(seatsSold === undefined ? {} : { seatsSold }),
    ...(seatsAvailable === undefined ? {} : { seatsAvailable }),
  };
}

export function toHaulageSheetPayload(
  state: SheetFormState,
  ids: SheetIds,
  offsetMinutes?: number,
): HaulageSheetPayload {
  const cargoDescription = text(state.cargoDescription);
  const cargoWeightKg = parseCount(state.cargoWeightKg);
  return {
    ...toSheetBase(state, ids, offsetMinutes),
    ...(cargoDescription === undefined ? {} : { cargoDescription }),
    ...(cargoWeightKg === undefined ? {} : { cargoWeightKg }),
  };
}

/**
 * How many money lines the sheet left waiting for an approver. The composite
 * command commits either way, so the confirmation has to say what is pending
 * instead of implying everything posted.
 */
export function pendingChildrenCount(result: CommandResult): number {
  return (result.children ?? []).filter((child) => child.status === "SUBMITTED")
    .length;
}
