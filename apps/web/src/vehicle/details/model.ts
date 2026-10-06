import {
  assetDetailFields,
  assetIdentityProblem,
  latestModelYear,
  MODEL_YEAR_MIN,
  TEMPLATE_FIELDS,
  type AssetDetail,
  type TemplateCode,
  type TemplateFieldDef,
  type UpdateAssetDetailsPayload,
} from "@routiq/contracts";
import { moneyAmountParts, parseWholeAmount } from "@/lib/format.js";

/** The Details card in edit mode, as typed: every value a string. */
export interface DetailsFormValues {
  registrationNumber: string;
  manufacturer: string;
  model: string;
  modelYear: string;
  chassisNumber: string;
  acquisitionDate: string;
  acquisitionAmount: string;
  customValues: Record<string, string>;
}

export type DetailsFieldName =
  | Exclude<keyof DetailsFormValues, "customValues">
  | `customValues.${string}`;

export type DetailsProblem =
  | "yearRange"
  | "dateInFuture"
  | "amountWhole"
  | "amountNeedsDate"
  | "plateTooLong"
  | "chassisTooLong"
  | "notANumber"
  | "invalid";

export const DISPOSED_STATUSES = ["SOLD", "RETIRED", "WRITTEN_OFF"] as const;

export function isDisposed(status: string): boolean {
  return (DISPOSED_STATUSES as readonly string[]).includes(status);
}

/** The template's specification fields a person can type: text and numbers. */
export function editableSpecifications(templateCode: string): TemplateFieldDef[] {
  return (TEMPLATE_FIELDS[templateCode as TemplateCode] ?? []).filter((field) => field.type !== "boolean");
}

const text = (value: string | null | undefined) => value ?? "";

export function formValuesOf(asset: AssetDetail, locale: string): DetailsFormValues {
  const customValues: Record<string, string> = {};
  for (const field of editableSpecifications(asset.templateCode)) {
    const value = asset.customValues[field.key];
    customValues[field.key] = typeof value === "string" || typeof value === "number" ? String(value) : "";
  }
  return {
    registrationNumber: text(asset.registrationNumber),
    manufacturer: text(asset.manufacturer),
    model: text(asset.model),
    modelYear: asset.modelYear === null ? "" : String(asset.modelYear),
    chassisNumber: text(asset.chassisNumber),
    acquisitionDate: text(asset.acquisitionDate),
    acquisitionAmount:
      asset.acquisitionAmountMinor === null
        ? ""
        : moneyAmountParts(asset.acquisitionAmountMinor, { currency: asset.currency, locale }).amount,
    customValues,
  };
}

/** "26.5" and "26,5" are the same tonnage; anything else is not a number. */
function parseSpecNumber(raw: string): number | undefined {
  const normalized = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return undefined;
  return Number(normalized);
}

const trimmedOrNull = (raw: string) => (raw.trim() === "" ? null : raw.trim());

/** Today in the reader's own calendar, as an ISO date. */
export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

interface CheckContext {
  /** What the card opened with: a field still holding it is not re-checked. */
  initial: DetailsFormValues;
  locale: string;
  templateCode: string;
  /** Whether this reader sees, and so may set, the acquisition amount. */
  money: boolean;
  today: string;
}

/** The text a field holds, so two snapshots of the card can be compared. */
function fieldText(values: DetailsFormValues, field: DetailsFieldName): string {
  return field.startsWith("customValues.")
    ? (values.customValues[field.slice("customValues.".length)] ?? "")
    : values[field as Exclude<DetailsFieldName, `customValues.${string}`>];
}

const untouched = (values: DetailsFormValues, initial: DetailsFormValues, field: DetailsFieldName) =>
  fieldText(values, field) === fieldText(initial, field);

/**
 * The same rules `update-asset-details` applies, asked of the contract's own
 * field schemas, each problem pinned to the field that has to change.
 *
 * Only fields the person changed are checked, as the server checks only the
 * fields that travel: a vehicle register-asset v1 let in with a longer chassis
 * number, or an amount without a date, still saves a new plate (#122).
 */
export function detailsProblems(
  values: DetailsFormValues,
  context: CheckContext,
): Array<{ field: DetailsFieldName; problem: DetailsProblem }> {
  const problems: Array<{ field: DetailsFieldName; problem: DetailsProblem }> = [];
  const checkText = (
    field: "manufacturer" | "model",
  ) => {
    const value = trimmedOrNull(values[field]);
    if (value !== null && !assetDetailFields[field].safeParse(value).success) {
      problems.push({ field, problem: "invalid" });
    }
  };
  if (assetIdentityProblem("registrationNumber", values.registrationNumber) !== undefined) {
    problems.push({ field: "registrationNumber", problem: "plateTooLong" });
  }
  checkText("manufacturer");
  checkText("model");

  const year = values.modelYear.trim();
  if (year !== "" && (!/^\d+$/.test(year) || !assetDetailFields.modelYear.safeParse(Number(year)).success)) {
    problems.push({ field: "modelYear", problem: "yearRange" });
  }

  if (assetIdentityProblem("chassisNumber", values.chassisNumber) !== undefined) {
    problems.push({ field: "chassisNumber", problem: "chassisTooLong" });
  }

  if (values.acquisitionDate !== "" && values.acquisitionDate > context.today) {
    problems.push({ field: "acquisitionDate", problem: "dateInFuture" });
  }

  if (context.money) {
    const amount = parseWholeAmount(values.acquisitionAmount, context.locale);
    if (amount.kind === "invalid") {
      problems.push({ field: "acquisitionAmount", problem: "amountWhole" });
    } else if (amount.kind === "amount" && values.acquisitionDate === "") {
      problems.push({ field: "acquisitionDate", problem: "amountNeedsDate" });
    }
  }

  for (const field of editableSpecifications(context.templateCode)) {
    const raw = values.customValues[field.key] ?? "";
    if (raw.trim() === "") continue;
    if (field.type === "number" && parseSpecNumber(raw) === undefined) {
      problems.push({ field: `customValues.${field.key}`, problem: "notANumber" });
    } else if (field.type === "string" && !assetDetailFields.customValue.safeParse(raw).success) {
      problems.push({ field: `customValues.${field.key}`, problem: "invalid" });
    }
  }
  const changed = (field: DetailsFieldName) => !untouched(values, context.initial, field);
  return problems.filter(({ field, problem }) =>
    problem === "amountNeedsDate"
      ? changed("acquisitionDate") || changed("acquisitionAmount")
      : changed(field),
  );
}

type Changes = Omit<UpdateAssetDetailsPayload, "assetId">;

/**
 * Only what moved, as the command wants it: a cleared field is `null`, an
 * untouched one (still the text the card opened with) is absent. Undefined when nothing moved. Assumes the values
 * passed `detailsProblems`.
 */
export function changedDetails(
  values: DetailsFormValues,
  asset: AssetDetail,
  context: { locale: string; money: boolean },
): Changes | undefined {
  const initial = formValuesOf(asset, context.locale);
  const changed = (field: DetailsFieldName) => !untouched(values, initial, field);
  const changes: Changes = {};
  for (const field of ["registrationNumber", "manufacturer", "model", "chassisNumber"] as const) {
    const next = trimmedOrNull(values[field]);
    if (changed(field) && next !== asset[field]) changes[field] = next;
  }
  const year = values.modelYear.trim() === "" ? null : Number(values.modelYear.trim());
  if (changed("modelYear") && year !== asset.modelYear) changes.modelYear = year;
  const date = values.acquisitionDate === "" ? null : values.acquisitionDate;
  if (changed("acquisitionDate") && date !== asset.acquisitionDate) changes.acquisitionDate = date;
  if (context.money && changed("acquisitionAmount")) {
    const amount = parseWholeAmount(values.acquisitionAmount, context.locale);
    const next = amount.kind === "amount" ? amount.minor : null;
    if (next !== asset.acquisitionAmountMinor) changes.acquisitionAmountMinor = next;
  }

  const customValues: Record<string, string | number | null> = {};
  for (const field of editableSpecifications(asset.templateCode)) {
    const raw = values.customValues[field.key] ?? "";
    const next = raw.trim() === "" ? null : field.type === "number" ? (parseSpecNumber(raw) ?? null) : raw.trim();
    const before = asset.customValues[field.key] ?? null;
    if (changed(`customValues.${field.key}`) && next !== before) customValues[field.key] = next;
  }
  if (Object.keys(customValues).length > 0) changes.customValues = customValues;

  return Object.keys(changes).length === 0 ? undefined : changes;
}

export const YEAR_BOUNDS = { min: MODEL_YEAR_MIN, max: () => latestModelYear() };
