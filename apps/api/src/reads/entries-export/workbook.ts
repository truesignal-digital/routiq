import type { CancelledEntryRef } from "@routiq/contracts";
import type { Cell, Row, Sheet } from "write-excel-file/node";
import type { CancellationRow } from "../entry-cancellation.js";
import { serializeMinor } from "../serialize-minor.js";
import { monthName, type ExportWords } from "./words.js";

const AMOUNT_FORMAT = "#,##0";

/** One `financial_entries` row as the export reads it. */
export interface ExportEntry {
  id: string;
  entryNumber: string;
  direction: "EXPENSE" | "REVENUE";
  status: "SUBMITTED" | "POSTED" | "REJECTED" | "REVERSED";
  /** The vehicle's share when the list is one vehicle's, else the entry's amount. */
  amountMinor: bigint;
  currency: string;
  economicDate: string;
  postingPeriodCode: string | null;
  categoryLabel: string;
  description: string | null;
  vehicle: string | null;
  trip: string | null;
  reversesEntryId: string | null;
  /** On a cancellation row: the reason its own command gave. */
  reversalReasonCode: string | null;
  reversalReasonText: string | null;
  recordedBy: string | null;
  approvedBy: string | null;
  cancelledBy: CancellationRow | null;
  cancels: CancelledEntryRef | null;
}

/** What ROUTIQ counts for the same rows, summed in SQL in whole minor units. */
export interface ExportTotals {
  expenseMinor: bigint;
  revenueMinor: bigint;
}

export interface ExportHeader {
  company: string;
  list: string;
  period: string;
  branch: string;
  filters: string;
  exportedOn: string;
  currency: string;
}

const LEDGER = new Set<ExportEntry["status"]>(["POSTED", "REVERSED"]);

export function countsInTotals(entry: Pick<ExportEntry, "status">): boolean {
  return LEDGER.has(entry.status);
}

/** A business date as Excel stores one: midnight UTC, so no time zone shifts the day. */
function excelDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day));
}

function text(value: string | null | undefined): Cell {
  return value === null || value === undefined || value === "" ? null : { value, type: String };
}

function amount(value: bigint): Cell {
  return { value: serializeMinor(value), type: Number, format: AMOUNT_FORMAT };
}

function date(isoDate: string, words: ExportWords): Cell {
  return { value: excelDate(isoDate), type: Date, format: words.dateFormat };
}

function header(labels: readonly string[]): Row {
  return labels.map((label) => ({ value: label, type: String, fontWeight: "bold" as const }));
}

function reasonLabel(words: ExportWords, code: string | null, reasonText: string | null): string | null {
  if (code !== null && code in words.reasons) {
    return words.reasons[code as keyof ExportWords["reasons"]];
  }
  return reasonText;
}

/** A column letter for a 0-based index (A … Z, AA …). */
export function columnLetter(index: number): string {
  let letter = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter;
  }
  return letter;
}

function sheetRef(name: string): string {
  return `'${name.replaceAll("'", "''")}'`;
}

function formulaText(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

const ENTRY_COLUMNS = [
  "date",
  "number",
  "vehicle",
  "trip",
  "category",
  "description",
  "type",
  "amount",
  "currency",
  "inTotals",
  "status",
  "cancellationReason",
  "recordedBy",
  "approvedBy",
] as const satisfies readonly (keyof ExportWords["columns"])[];

const BOOK_COLUMNS = [
  "date",
  "number",
  "vehicle",
  "trip",
  "category",
  "description",
  "type",
  "amount",
  "currency",
  "status",
  "period",
  "cancelsEntry",
  "cancelledByEntry",
  "countsInTotals",
  "recordedBy",
] as const satisfies readonly (keyof ExportWords["columns"])[];

function col<T extends readonly string[]>(columns: T, key: T[number]): string {
  return columnLetter(columns.indexOf(key));
}

const WIDTHS: Record<keyof ExportWords["columns"], number> = {
  date: 16,
  number: 16,
  vehicle: 14,
  trip: 14,
  category: 22,
  description: 32,
  type: 10,
  amount: 14,
  currency: 8,
  inTotals: 14,
  status: 26,
  cancellationReason: 26,
  recordedBy: 20,
  approvedBy: 20,
  period: 12,
  cancelsEntry: 16,
  cancelledByEntry: 16,
  countsInTotals: 12,
};

/**
 * One line per event (#427): a posted cancellation whose original is in the
 * same file folds into the original's line, which then counts their sum, 0.
 * Folding needs the original in the file, so a line never loses an amount
 * that no other line carries.
 */
export function foldCancellations(entries: readonly ExportEntry[]): {
  lines: ExportEntry[];
  folded: Map<string, bigint>;
} {
  const ids = new Set(entries.map((entry) => entry.id));
  const folded = new Map<string, bigint>();
  const lines: ExportEntry[] = [];
  for (const entry of entries) {
    if (entry.reversesEntryId !== null && entry.status === "POSTED" && ids.has(entry.reversesEntryId)) {
      folded.set(entry.reversesEntryId, (folded.get(entry.reversesEntryId) ?? 0n) + entry.amountMinor);
    } else {
      lines.push(entry);
    }
  }
  return { lines, folded };
}

function entryStatus(words: ExportWords, entry: ExportEntry, isFolded: boolean): string {
  if (entry.reversesEntryId !== null) {
    return entry.cancels === null ? words.cancellation : words.cancellationOf(entry.cancels.entryNumber);
  }
  if (entry.status === "REVERSED" && !isFolded && entry.cancelledBy?.postingPeriodCode) {
    return words.cancelledIn(monthName(words, entry.cancelledBy.postingPeriodCode));
  }
  return words.status[entry.status];
}

function entryReason(words: ExportWords, entry: ExportEntry): string | null {
  if (entry.reversesEntryId !== null) {
    return reasonLabel(words, entry.reversalReasonCode, entry.reversalReasonText);
  }
  if (entry.cancelledBy === null) return null;
  return reasonLabel(words, entry.cancelledBy.reasonCode, entry.cancelledBy.reasonText);
}

function entriesSheet(words: ExportWords, entries: readonly ExportEntry[]): Sheet<never> {
  const { lines, folded } = foldCancellations(entries);
  const data: Row[] = [header(ENTRY_COLUMNS.map((key) => words.columns[key]))];
  for (const entry of lines) {
    const foldedMinor = folded.get(entry.id);
    data.push([
      date(entry.economicDate, words),
      text(entry.entryNumber),
      text(entry.vehicle),
      text(entry.trip),
      text(entry.categoryLabel),
      text(entry.description),
      text(words.direction[entry.direction]),
      amount(entry.amountMinor),
      text(entry.currency),
      countsInTotals(entry) ? amount(entry.amountMinor + (foldedMinor ?? 0n)) : null,
      text(entryStatus(words, entry, foldedMinor !== undefined)),
      text(entryReason(words, entry)),
      text(entry.recordedBy),
      text(entry.approvedBy),
    ]);
  }
  return {
    sheet: words.sheets.entries,
    data,
    columns: ENTRY_COLUMNS.map((key) => ({ width: WIDTHS[key] })),
    stickyRowsCount: 1,
  };
}

function booksSheet(words: ExportWords, entries: readonly ExportEntry[]): Sheet<never> {
  const data: Row[] = [header(BOOK_COLUMNS.map((key) => words.columns[key]))];
  for (const entry of entries) {
    data.push([
      date(entry.economicDate, words),
      text(entry.entryNumber),
      text(entry.vehicle),
      text(entry.trip),
      text(entry.categoryLabel),
      text(entry.description),
      text(words.direction[entry.direction]),
      amount(entry.amountMinor),
      text(entry.currency),
      text(entry.reversesEntryId === null ? words.status[entry.status] : words.cancellation),
      text(entry.postingPeriodCode),
      text(entry.cancels?.entryNumber),
      text(entry.cancelledBy?.entryNumber),
      text(countsInTotals(entry) ? words.yes : words.no),
      text(entry.recordedBy),
    ]);
  }
  return {
    sheet: words.sheets.books,
    data,
    columns: BOOK_COLUMNS.map((key) => ({ width: WIDTHS[key] })),
    stickyRowsCount: 1,
  };
}

/** Rows of the Check sheet, 1-based as Excel counts them. */
export const CHECK_ROWS = { currency: 8, table: 10, expenses: 11, revenue: 12, net: 13, matches: 15 } as const;

function checkSheet(words: ExportWords, head: ExportHeader, totals: ExportTotals): Sheet<never> {
  const entries = sheetRef(words.sheets.entries);
  const books = sheetRef(words.sheets.books);
  const currencyCell = `$B$${CHECK_ROWS.currency}`;
  const entriesSum = (direction: "EXPENSE" | "REVENUE") => {
    const sum = col(ENTRY_COLUMNS, "inTotals");
    const type = col(ENTRY_COLUMNS, "type");
    const currency = col(ENTRY_COLUMNS, "currency");
    return `SUMIFS(${entries}!$${sum}:$${sum},${entries}!$${type}:$${type},${formulaText(words.direction[direction])},${entries}!$${currency}:$${currency},${currencyCell})`;
  };
  const booksSum = (direction: "EXPENSE" | "REVENUE") => {
    const sum = col(BOOK_COLUMNS, "amount");
    const type = col(BOOK_COLUMNS, "type");
    const currency = col(BOOK_COLUMNS, "currency");
    const counts = col(BOOK_COLUMNS, "countsInTotals");
    return `SUMIFS(${books}!$${sum}:$${sum},${books}!$${type}:$${type},${formulaText(words.direction[direction])},${books}!$${currency}:$${currency},${currencyCell},${books}!$${counts}:$${counts},${formulaText(words.yes)})`;
  };
  const formula = (value: string, format?: string): Cell => ({
    value,
    type: "Formula",
    ...(format === undefined ? {} : { format }),
  });
  const yes = formulaText(words.yes);
  const no = formulaText(words.no);
  const matchRow = (row: number) => formula(`IF(AND(B${row}=C${row},B${row}=D${row}),${yes},${no})`);
  const { expenses, revenue, net } = CHECK_ROWS;
  const label = (value: string): Cell => ({ value, type: String, fontWeight: "bold" });

  const data: Row[] = [
    [label(words.check.title)],
    [label(words.check.company), text(head.company)],
    [label(words.check.list), text(head.list)],
    [label(words.check.period), text(head.period)],
    [label(words.check.branch), text(head.branch)],
    [label(words.check.filters), text(head.filters)],
    [label(words.check.exportedOn), date(head.exportedOn, words)],
    [label(words.check.currency), text(head.currency)],
    [],
    header(["", words.check.routiq, words.check.entriesSheet, words.check.booksSheet, words.check.matches]),
    [
      label(words.check.expenses),
      amount(totals.expenseMinor),
      formula(entriesSum("EXPENSE"), AMOUNT_FORMAT),
      formula(booksSum("EXPENSE"), AMOUNT_FORMAT),
      matchRow(expenses),
    ],
    [
      label(words.check.revenue),
      amount(totals.revenueMinor),
      formula(entriesSum("REVENUE"), AMOUNT_FORMAT),
      formula(booksSum("REVENUE"), AMOUNT_FORMAT),
      matchRow(revenue),
    ],
    [
      label(words.check.net),
      amount(totals.revenueMinor - totals.expenseMinor),
      formula(`C${revenue}-C${expenses}`, AMOUNT_FORMAT),
      formula(`D${revenue}-D${expenses}`, AMOUNT_FORMAT),
      matchRow(net),
    ],
    [],
    [
      label(words.check.matchesRoutiq),
      formula(`IF(AND(E${expenses}=${yes},E${revenue}=${yes},E${net}=${yes}),${yes},${no})`),
    ],
    [],
    [text(words.check.notCounted)],
    [text(words.check.readOnly)],
  ];
  return {
    sheet: words.sheets.check,
    data,
    columns: [{ width: 26 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 12 }],
  };
}

/** The three sheets, Entries first so the file opens on the list. */
export function buildWorkbook(
  words: ExportWords,
  head: ExportHeader,
  entries: readonly ExportEntry[],
  totals: ExportTotals,
): Sheet<never>[] {
  return [entriesSheet(words, entries), booksSheet(words, entries), checkSheet(words, head, totals)];
}
