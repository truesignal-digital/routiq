export type CsvSeparator = "," | ";";

export type CsvParse =
  | { ok: true; separator: CsvSeparator; rows: CsvRow[] }
  | { ok: false; code: "UNCLOSED_QUOTE"; line: number };

/** One record of the file. `line` is where it starts, counting the header as line 1. */
export interface CsvRow {
  line: number;
  cells: string[];
}

const BOM = "﻿";

/**
 * RFC 4180 with the two habits of the spreadsheets our users save from: French
 * Excel separates with semicolons, and Excel's "CSV UTF-8" starts with a
 * byte-order mark. The separator is whichever of the two the header line uses
 * more, outside quotes. Blank records are dropped.
 */
export function parseCsv(input: string): CsvParse {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const separator = detectSeparator(text);
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  const endRow = () => {
    cells.push(cell);
    if (cells.some((value) => value.trim() !== "")) rows.push({ line: rowLine, cells });
    cells = [];
    cell = "";
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === "\n") line += 1;
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell.trim() === "") {
      cell = "";
      quoted = true;
    } else if (char === separator) {
      cells.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      endRow();
      line += 1;
      rowLine = line;
    } else {
      cell += char;
    }
  }
  if (quoted) return { ok: false, code: "UNCLOSED_QUOTE", line: rowLine };
  if (cell !== "" || cells.length > 0) endRow();
  return { ok: true, separator, rows };
}

function detectSeparator(text: string): CsvSeparator {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && char === ",") commas += 1;
    else if (!quoted && char === ";") semicolons += 1;
  }
  return semicolons > commas ? ";" : ",";
}

/** A file Excel opens as UTF-8 in either language: byte-order mark, CRLF, quotes only where needed. */
export function toCsv(rows: readonly (readonly string[])[], separator: CsvSeparator): string {
  const quote = (value: string) =>
    value.includes(separator) || value.includes('"') || /[\r\n]/.test(value)
      ? `"${value.replaceAll('"', '""')}"`
      : value;
  return BOM + rows.map((row) => row.map(quote).join(separator)).join("\r\n") + "\r\n";
}
