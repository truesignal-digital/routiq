import type { LegEndpoint } from "@routiq/contracts";
import type {
  SheetCrewRole,
  SheetEntryDirection,
  SheetFormState,
  SheetLoadState,
  SheetPaymentMethod,
  SheetReadingType,
  SheetSegmentRole,
  SheetTemplate,
} from "../sheet-model.js";

export const READING_TYPES = ["ODOMETER", "HOURS"] as const satisfies readonly SheetReadingType[];
export const SEGMENT_ROLES = ["TRAILER", "RECOVERY"] as const satisfies readonly SheetSegmentRole[];
export const CREW_ROLES = [
  "DRIVER",
  "CONDUCTOR",
  "ASSISTANT",
  "RELIEF",
  "MECHANIC",
  "OTHER",
] as const satisfies readonly SheetCrewRole[];
export const LOAD_STATES = ["LADEN", "EMPTY", "PARTIAL"] as const satisfies readonly SheetLoadState[];
export const PAYMENT_METHODS = [
  "CASH",
  "MOMO",
  "OM",
  "BANK",
  "OTHER",
] as const satisfies readonly SheetPaymentMethod[];

/**
 * Form rows keep every control's value as the string its input produces, and a
 * blank means "the sheet did not say" rather than zero. Turning that into the
 * payload is `sheet-model`'s job; this module only decides what a row is.
 */
export interface SegmentFormRow {
  segmentId: string;
  assetId: string;
  role: SheetSegmentRole;
  startedAt: string;
  endedAt: string;
}

export interface CrewFormRow {
  activityPersonId: string;
  personId: string;
  role: SheetCrewRole;
}

export interface LegFormRow {
  legId: string;
  origin?: LegEndpoint | undefined;
  destination?: LegEndpoint | undefined;
  departedAt: string;
  arrivedAt: string;
  distanceKm: string;
  passengerCount: string;
  loadState: SheetLoadState | "";
}

export interface EntryFormRow {
  entryId: string;
  direction: SheetEntryDirection;
  categoryCode: string;
  amount: string;
  paymentMethod: SheetPaymentMethod;
  counterpartyName: string;
  description: string;
  reference: string;
  assetId: string;
  personId: string;
  attributeToActivity: boolean;
}

export interface ReadingFormValues {
  value: string;
  readingType: SheetReadingType;
}

export interface SheetFormValues {
  template: SheetTemplate;
  branchCode: string;
  activityTypeCode: string;
  customerName: string;
  clientReference: string;
  description: string;
  primaryAssetId: string;
  startedAt: string;
  endedAt: string;
  startReading: ReadingFormValues;
  endReading: ReadingFormValues;
  extraSegments: SegmentFormRow[];
  crew: CrewFormRow[];
  legs: LegFormRow[];
  entries: EntryFormRow[];
  seatsSold: string;
  seatsAvailable: string;
  cargoDescription: string;
  cargoWeightKg: string;
}

export function endpointText(endpoint: LegEndpoint | undefined): string {
  if (endpoint === undefined) return "";
  return endpoint.kind === "place" ? endpoint.name : endpoint.text;
}

/**
 * A row the clerk never touched. Sections open with a row already there so the
 * common sheet needs no clicks, which means submit has to tell "left empty"
 * apart from "half filled" — the first is dropped, the second is an error.
 */
export function isBlankCrew(row: CrewFormRow): boolean {
  return row.personId === "";
}

export function isBlankLeg(row: LegFormRow): boolean {
  return (
    endpointText(row.origin).trim() === "" &&
    endpointText(row.destination).trim() === "" &&
    row.departedAt === "" &&
    row.arrivedAt === "" &&
    row.distanceKm.trim() === "" &&
    row.passengerCount.trim() === "" &&
    row.loadState === ""
  );
}

export function isBlankSegment(row: SegmentFormRow): boolean {
  return row.assetId === "";
}

export function isBlankEntry(row: EntryFormRow): boolean {
  return (
    row.categoryCode === "" &&
    row.amount.trim() === "" &&
    row.counterpartyName.trim() === "" &&
    row.description.trim() === "" &&
    row.reference.trim() === ""
  );
}

export function newCrewRow(role: SheetCrewRole = "DRIVER"): CrewFormRow {
  return { activityPersonId: crypto.randomUUID(), personId: "", role };
}

export function newLegRow(): LegFormRow {
  return {
    legId: crypto.randomUUID(),
    departedAt: "",
    arrivedAt: "",
    distanceKm: "",
    passengerCount: "",
    loadState: "",
  };
}

export function newSegmentRow(): SegmentFormRow {
  return {
    segmentId: crypto.randomUUID(),
    assetId: "",
    role: "TRAILER",
    startedAt: "",
    endedAt: "",
  };
}

export function newEntryRow(direction: SheetEntryDirection = "REVENUE"): EntryFormRow {
  return {
    entryId: crypto.randomUUID(),
    direction,
    categoryCode: "",
    amount: "",
    paymentMethod: "CASH",
    counterpartyName: "",
    description: "",
    reference: "",
    assetId: "",
    personId: "",
    attributeToActivity: true,
  };
}

export function defaultSheetValues(
  template: SheetTemplate,
  { revenue }: { revenue: boolean } = { revenue: true },
): SheetFormValues {
  return {
    template,
    branchCode: "",
    activityTypeCode: "",
    customerName: "",
    clientReference: "",
    description: "",
    primaryAssetId: "",
    startedAt: "",
    endedAt: "",
    startReading: { value: "", readingType: "ODOMETER" },
    endReading: { value: "", readingType: "ODOMETER" },
    extraSegments: [],
    crew: [newCrewRow("DRIVER")],
    legs: [newLegRow()],
    // A passenger run always took money; a haul is billed by the office, so it
    // opens with no money line rather than an empty one to dismiss. A driver
    // records no revenue (#532), so their sheet opens with none either.
    entries: template === "journey" && revenue ? [newEntryRow("REVENUE")] : [],
    seatsSold: "",
    seatsAvailable: "",
    cargoDescription: "",
    cargoWeightKg: "",
  };
}

/** The form as `sheet-model` wants it: untouched rows gone, blanks absent. */
export function toSheetFormState(values: SheetFormValues): SheetFormState {
  return {
    template: values.template,
    branchCode: values.branchCode,
    activityTypeCode: values.activityTypeCode,
    primaryAssetId: values.primaryAssetId,
    startedAt: values.startedAt,
    endedAt: values.endedAt,
    customerName: values.customerName,
    clientReference: values.clientReference,
    description: values.description,
    startReading: values.startReading,
    endReading: values.endReading,
    extraSegments: values.extraSegments
      .filter((row) => !isBlankSegment(row))
      .map((row) => ({
        segmentId: row.segmentId,
        assetId: row.assetId,
        role: row.role,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
      })),
    crew: values.crew.filter((row) => !isBlankCrew(row)),
    legs: values.legs
      .filter((row) => !isBlankLeg(row))
      .map((row, index) => ({
        legId: row.legId,
        legNo: index + 1,
        origin: row.origin ?? { kind: "text", text: "" },
        destination: row.destination ?? { kind: "text", text: "" },
        departedAt: row.departedAt,
        arrivedAt: row.arrivedAt,
        distanceKm: row.distanceKm,
        ...(values.template === "journey"
          ? { passengerCount: row.passengerCount }
          : row.loadState === ""
            ? {}
            : { loadState: row.loadState }),
      })),
    entries: values.entries
      .filter((row) => !isBlankEntry(row))
      .map((row) => ({
        entryId: row.entryId,
        direction: row.direction,
        categoryCode: row.categoryCode,
        amount: row.amount,
        paymentMethod: row.paymentMethod,
        counterpartyName: row.counterpartyName,
        description: row.description,
        reference: row.reference,
        assetId: row.assetId,
        personId: row.personId,
        attributeToActivity: row.attributeToActivity,
      })),
    ...(values.template === "journey"
      ? { seatsSold: values.seatsSold, seatsAvailable: values.seatsAvailable }
      : {
          cargoDescription: values.cargoDescription,
          cargoWeightKg: values.cargoWeightKg,
        }),
  };
}
