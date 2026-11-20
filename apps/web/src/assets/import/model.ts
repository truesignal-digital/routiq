import {
  plateKey,
  registerAssetPayload,
  TEMPLATE_CODES,
  TEMPLATE_FIELDS,
  templateFieldIssues,
  type RegisterAssetPayload,
  type TemplateCode,
} from "@routiq/contracts";
import { parseCsv, type CsvRow } from "./csv.js";

export const IMPORT_MAX_ROWS = 500;

const CAPACITY_UNITS = ["KG", "TONNE", "M3", "SEAT"] as const;
type CapacityUnit = (typeof CAPACITY_UNITS)[number];

const BASE_FIELDS = [
  "assetCode",
  "assetClass",
  "branch",
  "template",
  "registrationNumber",
  "chassisNumber",
  "manufacturer",
  "model",
  "modelYear",
  "capacityValue",
  "capacityUnit",
  "acquisitionDate",
  "acquisitionAmount",
] as const;

/** A column of the import file: a `register-asset` field, or `custom.<key>` for a template field. */
export type ImportField = (typeof BASE_FIELDS)[number] | `custom.${string}`;

export const REQUIRED_FIELDS: readonly ImportField[] = ["assetCode", "assetClass", "branch"];

/** The vehicle as it will be sent; the asset id is derived later from the row itself. */
export type ImportPayload = Omit<RegisterAssetPayload, "assetId">;

/** Every column an import may carry, in template order, for the presets the workspace runs. */
export function importFields(enabledPresets: readonly TemplateCode[]): ImportField[] {
  const custom = [...new Set(enabledPresets.flatMap((code) => TEMPLATE_FIELDS[code].map((f) => f.key)))];
  const fields: ImportField[] = BASE_FIELDS.filter((field) => field !== "template" || enabledPresets.length > 1);
  const at = fields.indexOf("capacityUnit") + 1;
  fields.splice(at, 0, ...custom.map((key) => `custom.${key}` as const));
  return fields;
}

/** The catalog key whose text heads a column; the same words as the register form. */
export function fieldLabelKey(field: ImportField): string {
  if (field.startsWith("custom.")) return `assets.form.${field}`;
  switch (field) {
    case "assetClass":
      return "assets.form.assetClass";
    case "acquisitionAmount":
      return "assets.form.acquisitionAmount";
    default:
      return `assets.form.${field}`;
  }
}

/** Every column across all presets, so a header names its field whatever presets are on. */
export function allImportFields(): ImportField[] {
  return importFields(TEMPLATE_CODES);
}

/**
 * Headers compare trimmed, case-insensitive, with runs of spaces collapsed and
 * the typographic apostrophe Excel autocorrects to read as the plain one.
 */
export function normalizeLabel(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr");
}

/** One parsed data row: its line in the file and the text under each recognised header. */
export interface ParsedRow {
  line: number;
  cells: Partial<Record<ImportField, string>>;
}

export type FileError =
  | { code: "EMPTY_FILE" }
  | { code: "UNCLOSED_QUOTE"; line: number }
  | { code: "UNKNOWN_HEADER"; header: string }
  | { code: "DUPLICATE_HEADER"; header: string }
  | { code: "MISSING_HEADER"; field: ImportField }
  | { code: "TOO_MANY_ROWS"; max: number; count: number };

export type ParsedFile = { ok: true; fields: ImportField[]; rows: ParsedRow[] } | { ok: false; error: FileError };

/**
 * Reads the file and maps its header to fields. `labels` maps each normalised
 * header text (French and English) to its field. An unknown or missing
 * required header stops the import: guessing a column would put a plate into a
 * chassis number.
 */
export function parseImportFile(text: string, labels: ReadonlyMap<string, ImportField>): ParsedFile {
  const parsed = parseCsv(text);
  if (!parsed.ok) return { ok: false, error: { code: "UNCLOSED_QUOTE", line: parsed.line } };
  const [header, ...data] = parsed.rows;
  if (header === undefined) return { ok: false, error: { code: "EMPTY_FILE" } };

  const columns: (ImportField | undefined)[] = [];
  const seen = new Set<ImportField>();
  for (const [index, raw] of header.cells.entries()) {
    const text = raw.trim();
    if (text === "") {
      if (data.some((row) => (row.cells[index] ?? "").trim() !== "")) {
        return { ok: false, error: { code: "UNKNOWN_HEADER", header: "" } };
      }
      columns.push(undefined);
      continue;
    }
    const field = labels.get(normalizeLabel(text));
    if (field === undefined) return { ok: false, error: { code: "UNKNOWN_HEADER", header: text } };
    if (seen.has(field)) return { ok: false, error: { code: "DUPLICATE_HEADER", header: text } };
    seen.add(field);
    columns.push(field);
  }
  const missing = REQUIRED_FIELDS.find((field) => !seen.has(field));
  if (missing !== undefined) return { ok: false, error: { code: "MISSING_HEADER", field: missing } };
  if (data.length === 0) return { ok: false, error: { code: "EMPTY_FILE" } };
  if (data.length > IMPORT_MAX_ROWS) {
    return { ok: false, error: { code: "TOO_MANY_ROWS", max: IMPORT_MAX_ROWS, count: data.length } };
  }

  return { ok: true, fields: [...seen], rows: data.map((row) => toParsedRow(row, columns)) };
}

function toParsedRow(row: CsvRow, columns: readonly (ImportField | undefined)[]): ParsedRow {
  const cells: Partial<Record<ImportField, string>> = {};
  for (const [index, field] of columns.entries()) {
    if (field === undefined) continue;
    const value = (row.cells[index] ?? "").trim();
    if (value !== "") cells[field] = value;
  }
  return { line: row.line, cells };
}

export type RowIssueCode =
  | "REQUIRED"
  | "INVALID"
  | "TOO_LONG"
  | "UNKNOWN_REFERENCE"
  | "DUPLICATE_IN_FILE"
  | "ALREADY_REGISTERED";

export interface RowIssue {
  field: ImportField;
  code: RowIssueCode;
}

/** What the preview says about one row: ready to send, or the reasons it will not be. */
export type RowVerdict =
  | { status: "ready"; line: number; payload: ImportPayload }
  | { status: "error"; line: number; issues: RowIssue[] };

/** What the workspace already holds, and the words its choices go by. */
export interface ImportContext {
  assetClasses: readonly { code: string; labelFr: string; labelEn: string }[];
  branches: readonly { code: string; name: string }[];
  enabledPresets: readonly TemplateCode[];
  /** Template and unit labels in both languages, matched like headers. */
  templateLabels: Readonly<Record<TemplateCode, readonly string[]>>;
  unitLabels: Readonly<Record<CapacityUnit, readonly string[]>>;
  existing: { assetCodes: ReadonlySet<string>; plates: ReadonlySet<string> };
}

/**
 * Every row through the `register-asset` contract schema, before anything is
 * sent. The server stays the enforcement point; this only spares the user a
 * round trip per typo.
 */
export function validateRows(rows: readonly ParsedRow[], context: ImportContext): RowVerdict[] {
  const verdicts = rows.map((row) => validateRow(row, context));

  const codeLines = countBy(rows, (cells) => cells.assetCode);
  const plateLines = countBy(rows, (cells) =>
    cells.registrationNumber === undefined ? undefined : plateKey(cells.registrationNumber),
  );
  return verdicts.map((verdict, index) => {
    const cells = rows[index]?.cells ?? {};
    const extra: RowIssue[] = [];
    if (cells.assetCode !== undefined) {
      if ((codeLines.get(cells.assetCode) ?? 0) > 1) extra.push({ field: "assetCode", code: "DUPLICATE_IN_FILE" });
      else if (context.existing.assetCodes.has(cells.assetCode)) extra.push({ field: "assetCode", code: "ALREADY_REGISTERED" });
    }
    if (cells.registrationNumber !== undefined) {
      const key = plateKey(cells.registrationNumber);
      if ((plateLines.get(key) ?? 0) > 1) extra.push({ field: "registrationNumber", code: "DUPLICATE_IN_FILE" });
      else if (context.existing.plates.has(key)) extra.push({ field: "registrationNumber", code: "ALREADY_REGISTERED" });
    }
    if (extra.length === 0) return verdict;
    const issues = verdict.status === "error" ? [...verdict.issues, ...extra] : extra;
    return { status: "error", line: verdict.line, issues };
  });
}

function countBy(
  rows: readonly ParsedRow[],
  keyOf: (cells: ParsedRow["cells"]) => string | undefined,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row.cells);
    if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

const importPayload = registerAssetPayload.omit({ assetId: true });

const SCHEMA_FIELD: Record<string, ImportField> = {
  assetCode: "assetCode",
  assetClassCode: "assetClass",
  branchCode: "branch",
  templateCode: "template",
  registrationNumber: "registrationNumber",
  chassisNumber: "chassisNumber",
  manufacturer: "manufacturer",
  model: "model",
  modelYear: "modelYear",
  acquisitionDate: "acquisitionDate",
  acquisitionAmountMinor: "acquisitionAmount",
  capacityValue: "capacityValue",
  capacityUnit: "capacityUnit",
};

function validateRow(row: ParsedRow, context: ImportContext): RowVerdict {
  const issues: RowIssue[] = [];
  const cells = row.cells;
  const fail = (field: ImportField, code: RowIssueCode) => {
    issues.push({ field, code });
    return undefined;
  };

  for (const field of REQUIRED_FIELDS) {
    if (cells[field] === undefined) fail(field, "REQUIRED");
  }

  const assetClassCode = pick(cells.assetClass, context.assetClasses, (c) => [c.code, c.labelFr, c.labelEn], (c) => c.code)
    ?? (cells.assetClass === undefined ? undefined : fail("assetClass", "UNKNOWN_REFERENCE"));
  const branchCode = pick(cells.branch, context.branches, (b) => [b.code, b.name], (b) => b.code)
    ?? (cells.branch === undefined ? undefined : fail("branch", "UNKNOWN_REFERENCE"));

  let templateCode: TemplateCode | undefined;
  if (cells.template === undefined) {
    templateCode = context.enabledPresets.length === 1 ? context.enabledPresets[0] : fail("template", "REQUIRED");
  } else {
    templateCode =
      pick(cells.template, context.enabledPresets, (code) => [code, ...context.templateLabels[code]], (code) => code) ??
      fail("template", "UNKNOWN_REFERENCE");
  }

  const capacityUnit =
    cells.capacityUnit === undefined
      ? undefined
      : (pick(cells.capacityUnit, CAPACITY_UNITS, (unit) => [unit, ...context.unitLabels[unit]], (unit) => unit) ??
        fail("capacityUnit", "UNKNOWN_REFERENCE"));

  const number = (field: ImportField, parse: (text: string) => number | undefined) => {
    const text = cells[field];
    if (text === undefined) return undefined;
    return parse(text) ?? fail(field, "INVALID");
  };
  const modelYear = number("modelYear", parseInteger);
  const capacityValue = number("capacityValue", parseDecimal);
  const acquisitionAmountMinor = number("acquisitionAmount", parseXafAmount);
  const acquisitionDate =
    cells.acquisitionDate === undefined ? undefined : (parseDate(cells.acquisitionDate) ?? fail("acquisitionDate", "INVALID"));

  const customValues: Record<string, unknown> = {};
  const templateFields = templateCode === undefined ? [] : TEMPLATE_FIELDS[templateCode];
  for (const [field, text] of Object.entries(cells)) {
    if (!field.startsWith("custom.") || text === undefined) continue;
    const key = field.slice("custom.".length);
    const def = templateFields.find((f) => f.key === key);
    if (def === undefined) {
      if (templateCode !== undefined) fail(field as ImportField, "INVALID");
      continue;
    }
    const value = def.type === "number" ? parseDecimal(text) : def.type === "boolean" ? parseBoolean(text) : text;
    if (value === undefined) fail(field as ImportField, "INVALID");
    else customValues[key] = value;
  }

  if (issues.length > 0) return { status: "error", line: row.line, issues };

  const candidate = {
    assetCode: cells.assetCode,
    assetClassCode,
    templateCode,
    branchCode,
    registrationNumber: cells.registrationNumber,
    chassisNumber: cells.chassisNumber,
    manufacturer: cells.manufacturer,
    model: cells.model,
    modelYear,
    acquisitionDate,
    acquisitionAmountMinor,
    capacityValue,
    capacityUnit,
    customValues,
  };
  const parsed = importPayload.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [head, key] = issue.path;
      const field = head === "customValues" ? (`custom.${String(key)}` as const) : SCHEMA_FIELD[String(head)];
      if (field === undefined) continue;
      issues.push({ field, code: issue.code === "too_big" ? "TOO_LONG" : "INVALID" });
    }
  }
  if (templateCode !== undefined) {
    for (const issue of templateFieldIssues(templateCode, customValues)) {
      issues.push({ field: `custom.${issue.key}`, code: issue.kind === "required" ? "REQUIRED" : "INVALID" });
    }
  }
  if (!parsed.success || issues.length > 0) {
    return { status: "error", line: row.line, issues: issues.length > 0 ? issues : [{ field: "assetCode", code: "INVALID" }] };
  }
  return { status: "ready", line: row.line, payload: parsed.data };
}

function pick<T, R>(
  text: string | undefined,
  choices: readonly T[],
  names: (choice: T) => readonly string[],
  value: (choice: T) => R,
): R | undefined {
  if (text === undefined) return undefined;
  const wanted = normalizeLabel(text);
  const found = choices.find((choice) => names(choice).some((name) => normalizeLabel(name) === wanted));
  return found === undefined ? undefined : value(found);
}

/** Spaces, including the non-breaking ones French Excel groups thousands with. */
const GROUPING = /[\s  ]/g;

function parseInteger(text: string): number | undefined {
  const digits = text.replace(GROUPING, "");
  return /^-?\d+$/.test(digits) ? Number(digits) : undefined;
}

function parseDecimal(text: string): number | undefined {
  const value = text.replace(GROUPING, "").replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : undefined;
}

/** XAF has exponent 0: the amount in the file is already in minor units, never divided. */
function parseXafAmount(text: string): number | undefined {
  const amount = parseInteger(text.replace(/\s*(FCFA|XAF)$/i, ""));
  return amount !== undefined && Number.isSafeInteger(amount) ? amount : undefined;
}

function parseBoolean(text: string): boolean | undefined {
  const value = normalizeLabel(text);
  if (["oui", "yes", "true", "vrai", "1"].includes(value)) return true;
  if (["non", "no", "false", "faux", "0"].includes(value)) return false;
  return undefined;
}

/** ISO (2026-07-29) or the day-first form French Excel writes (29/07/2026). */
function parseDate(text: string): string | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  const [year, month, day] = iso
    ? [iso[1], iso[2], iso[3]]
    : dayFirst
      ? [dayFirst[3], dayFirst[2]?.padStart(2, "0"), dayFirst[1]?.padStart(2, "0")]
      : [];
  if (year === undefined || month === undefined || day === undefined) return undefined;
  const [y, m, d] = [Number(year), Number(month), Number(day)];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined;
  return `${year}-${month}-${day}`;
}
