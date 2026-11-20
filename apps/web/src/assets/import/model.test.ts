import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv.js";
import {
  IMPORT_MAX_ROWS,
  normalizeLabel,
  parseImportFile,
  validateRows,
  type ImportContext,
  type ImportField,
  type ParsedRow,
} from "./model.js";

const FR: Partial<Record<ImportField, string>> = {
  assetCode: "Code de l'actif",
  assetClass: "Classe d'actif",
  branch: "Agence",
  registrationNumber: "Immatriculation",
  acquisitionAmount: "Montant d'acquisition (FCFA)",
  acquisitionDate: "Date d'acquisition",
  "custom.axleCount": "Nombre d'essieux",
};
const EN: Partial<Record<ImportField, string>> = {
  assetCode: "Asset code",
  assetClass: "Asset class",
  branch: "Branch",
  registrationNumber: "Registration number",
  acquisitionAmount: "Acquisition amount (FCFA)",
  acquisitionDate: "Acquisition date",
  "custom.axleCount": "Axle count",
};

const LABELS = new Map<string, ImportField>(
  [FR, EN].flatMap((set) =>
    Object.entries(set).map(([field, label = ""]) => [normalizeLabel(label), field as ImportField] as const),
  ),
);

const CONTEXT: ImportContext = {
  assetClasses: [{ code: "TRUCK", labelFr: "Camion", labelEn: "Truck" }],
  branches: [{ code: "DLA", name: "Douala" }],
  enabledPresets: ["TRUCKING"],
  templateLabels: { TRUCKING: ["Transport de marchandises", "Trucking"], PASSENGER_TRANSPORT: [] },
  unitLabels: { KG: [], TONNE: ["Tonnes"], M3: [], SEAT: [] },
  existing: { assetCodes: new Set(["VH-OLD"]), plates: new Set(["LT000AA"]) },
};

function rowsOf(text: string): ParsedRow[] {
  const parsed = parseImportFile(text, LABELS);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.rows;
}

describe("parseCsv", () => {
  it("reads comma and semicolon files alike, with quotes and CRLF", () => {
    const comma = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n');
    const semi = parseCsv('a;b\n"x; y";2,5\n');
    expect(comma).toEqual({ ok: true, separator: ",", rows: [{ line: 1, cells: ["a", "b"] }, { line: 2, cells: ["x, y", 'say "hi"'] }] });
    expect(semi).toEqual({ ok: true, separator: ";", rows: [{ line: 1, cells: ["a", "b"] }, { line: 2, cells: ["x; y", "2,5"] }] });
  });

  it("drops the byte-order mark Excel writes before the first header", () => {
    const parsed = parseCsv("﻿Code de l'actif;Agence\nVH1;DLA\n");
    expect(parsed.ok && parsed.rows[0]?.cells[0]).toBe("Code de l'actif");
  });

  it("round-trips what toCsv writes", () => {
    const text = toCsv([["Code", "Note"], ["VH1", 'a;b "c"']], ";");
    expect(text.startsWith("﻿")).toBe(true);
    const parsed = parseCsv(text);
    expect(parsed.ok && parsed.rows.map((row) => row.cells)).toEqual([["Code", "Note"], ["VH1", 'a;b "c"']]);
  });
});

describe("parseImportFile headers", () => {
  it("matches the French headers, trimmed and in any case", () => {
    const parsed = parseImportFile("  CODE DE L’ACTIF ; classe d'actif;Agence \nVH1;Camion;DLA\n", LABELS);
    expect(parsed).toEqual({
      ok: true,
      fields: ["assetCode", "assetClass", "branch"],
      rows: [{ line: 2, cells: { assetCode: "VH1", assetClass: "Camion", branch: "DLA" } }],
    });
  });

  it("matches the English headers, comma-separated", () => {
    const parsed = parseImportFile("Asset code,Asset class,branch,Registration number\nVH1,TRUCK,DLA,LT 101 AB\n", LABELS);
    expect(parsed.ok && parsed.rows[0]?.cells).toEqual({
      assetCode: "VH1",
      assetClass: "TRUCK",
      branch: "DLA",
      registrationNumber: "LT 101 AB",
    });
  });

  it("stops on an unknown header and names it", () => {
    expect(parseImportFile("Code de l'actif;Agence;Classe d'actif;Couleur\nVH1;DLA;TRUCK;rouge\n", LABELS)).toEqual({
      ok: false,
      error: { code: "UNKNOWN_HEADER", header: "Couleur" },
    });
  });

  it("stops on a missing required header and names the field", () => {
    expect(parseImportFile("Code de l'actif;Agence\nVH1;DLA\n", LABELS)).toEqual({
      ok: false,
      error: { code: "MISSING_HEADER", field: "assetClass" },
    });
  });

  it("refuses a header given twice, even across languages", () => {
    const parsed = parseImportFile("Agence;Branch;Asset code;Asset class\nDLA;DLA;VH1;TRUCK\n", LABELS);
    expect(parsed).toEqual({ ok: false, error: { code: "DUPLICATE_HEADER", header: "Branch" } });
  });

  it("refuses more than 500 rows", () => {
    const body = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `VH${i},TRUCK,DLA`).join("\n");
    expect(parseImportFile(`Asset code,Asset class,Branch\n${body}\n`, LABELS)).toEqual({
      ok: false,
      error: { code: "TOO_MANY_ROWS", max: IMPORT_MAX_ROWS, count: IMPORT_MAX_ROWS + 1 },
    });
  });
});

describe("validateRows", () => {
  it("turns a row into the register-asset payload, matching class and branch by label", () => {
    const rows = rowsOf(
      "Code de l'actif;Classe d'actif;Agence;Montant d'acquisition (FCFA);Date d'acquisition;Nombre d'essieux\n" +
        "VH1;camion;Douala;12 500 000;29/07/2026;3\n",
    );
    expect(validateRows(rows, CONTEXT)).toEqual([
      {
        status: "ready",
        line: 2,
        payload: {
          assetCode: "VH1",
          assetClassCode: "TRUCK",
          branchCode: "DLA",
          templateCode: "TRUCKING",
          acquisitionAmountMinor: 12_500_000,
          acquisitionDate: "2026-07-29",
          customValues: { axleCount: 3 },
        },
      },
    ]);
  });

  it("names the field and the reason of every error", () => {
    const rows = rowsOf("Asset code,Asset class,Branch,Acquisition amount (FCFA)\n,BUS,YDE,12.5\n");
    expect(validateRows(rows, CONTEXT)).toEqual([
      {
        status: "error",
        line: 2,
        issues: [
          { field: "assetCode", code: "REQUIRED" },
          { field: "assetClass", code: "UNKNOWN_REFERENCE" },
          { field: "branch", code: "UNKNOWN_REFERENCE" },
          { field: "acquisitionAmount", code: "INVALID" },
        ],
      },
    ]);
  });

  it("flags a code or plate repeated in the file or already registered", () => {
    const rows = rowsOf(
      "Asset code,Asset class,Branch,Registration number\n" +
        "VH1,TRUCK,DLA,LT 1 AA\nVH1,TRUCK,DLA,LT-1-aa\nVH-OLD,TRUCK,DLA,\nVH9,TRUCK,DLA,LT 000 AA\n",
    );
    const issues = validateRows(rows, CONTEXT).map((verdict) => (verdict.status === "error" ? verdict.issues : []));
    expect(issues).toEqual([
      [{ field: "assetCode", code: "DUPLICATE_IN_FILE" }, { field: "registrationNumber", code: "DUPLICATE_IN_FILE" }],
      [{ field: "assetCode", code: "DUPLICATE_IN_FILE" }, { field: "registrationNumber", code: "DUPLICATE_IN_FILE" }],
      [{ field: "assetCode", code: "ALREADY_REGISTERED" }],
      [{ field: "registrationNumber", code: "ALREADY_REGISTERED" }],
    ]);
  });

  it("asks for the template when the workspace runs more than one", () => {
    const rows = rowsOf("Asset code,Asset class,Branch\nVH1,TRUCK,DLA\n");
    const [verdict] = validateRows(rows, { ...CONTEXT, enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"] });
    expect(verdict).toEqual({ status: "error", line: 2, issues: [{ field: "template", code: "REQUIRED" }] });
  });
});
