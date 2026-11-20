import { randomUUID } from "node:crypto";
import {
  assetFinanceResponse,
  financeSummaryResponse,
  financialEntryListResponse,
  periodsResponse,
} from "@routiq/contracts";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentPeriodCode } from "../../commands/periods.js";
import { buildServer } from "../../server.js";
import { apiClient, seedActor, type Actor } from "../../test/client.js";
import { createTestApp } from "../../test/fixture.js";
import { seedAsset, seedWorkspace } from "../../test/seed.js";

interface XlsxCell {
  /** Shared string, inline number, or formula text. */
  kind: "string" | "number" | "formula";
  value: string;
  style: string | null;
}

type XlsxSheet = Map<string, XlsxCell>;

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/** Just enough of SpreadsheetML to read back what the export wrote. */
function readXlsx(file: Buffer) {
  const files = unzipSync(new Uint8Array(file));
  const read = (path: string) => {
    const content = files[path];
    if (content === undefined) throw new Error(`missing ${path}`);
    return strFromU8(content);
  };
  const workbook = read("xl/workbook.xml");
  const names = [...workbook.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((match) => decodeXml(match[1]!));
  const strings = [...read("xl/sharedStrings.xml").matchAll(/<si><t[^>]*>([\s\S]*?)<\/t><\/si>/g)].map((match) =>
    decodeXml(match[1]!),
  );
  const sheets = new Map<string, XlsxSheet>();
  names.forEach((name, index) => {
    const cells: XlsxSheet = new Map();
    const xml = read(`xl/worksheets/sheet${index + 1}.xml`);
    for (const match of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, attributes = "", body = ""] = match;
      const style = /s="(\d+)"/.exec(attributes)?.[1] ?? null;
      const formula = /<f>([\s\S]*?)<\/f>/.exec(body)?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      if (formula !== undefined) cells.set(ref!, { kind: "formula", value: decodeXml(formula), style });
      else if (value === undefined) continue;
      else if (attributes.includes('t="s"')) cells.set(ref!, { kind: "string", value: strings[Number(value)]!, style });
      else cells.set(ref!, { kind: "number", value, style });
    }
    sheets.set(name, cells);
  });
  return { names, sheets, workbook, styles: read("xl/styles.xml") };
}

/** The sheet as rows of text keyed by its header row, header row excluded. */
function table(sheet: XlsxSheet): Array<Record<string, XlsxCell | undefined>> {
  const headers = new Map<string, string>();
  let lastRow = 0;
  for (const [ref, cell] of sheet) {
    const [, column, row] = /^([A-Z]+)(\d+)$/.exec(ref)!;
    if (row === "1") headers.set(column!, cell.value);
    lastRow = Math.max(lastRow, Number(row));
  }
  const rows: Array<Record<string, XlsxCell | undefined>> = [];
  for (let row = 2; row <= lastRow; row++) {
    const record: Record<string, XlsxCell | undefined> = {};
    for (const [column, name] of headers) record[name] = sheet.get(`${column}${row}`);
    rows.push(record);
  }
  return rows;
}

/** Excel's day number for an ISO date (1900 date system). */
function excelSerial(isoDate: string): string {
  return String(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000 + 25_569);
}

/** What SUMIFS over a sheet gives: amounts of the rows of one type that count. */
function sumWhere(
  rows: Array<Record<string, XlsxCell | undefined>>,
  amountColumn: string,
  keep: (row: Record<string, XlsxCell | undefined>) => boolean,
): number {
  return rows.reduce((sum, row) => {
    const cell = row[amountColumn];
    if (cell === undefined || !keep(row)) return sum;
    expect(cell.kind).toBe("number");
    return sum + Number(cell.value);
  }, 0);
}

describe("GET /v1/finance/entries/export (#429)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let director: Actor;
  let finance: Actor;
  let driver: Actor;
  let otherDriver: Actor;
  let truck: string;
  let current: string;
  const MAY = "2026-05";
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    const workspaceId = seeded.workspace.id;
    director = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR", displayName: "Direction 429" });
    finance = await seedActor(ctx.db, { workspaceId, role: "FINANCE", displayName: "Finance 429" });
    driver = await seedActor(ctx.db, {
      workspaceId,
      role: "DRIVER",
      displayName: "Chauffeur A",
      branchIds: [seeded.branch.id],
    });
    otherDriver = await seedActor(ctx.db, {
      workspaceId,
      role: "DRIVER",
      displayName: "Chauffeur B",
      branchIds: [seeded.branch.id],
    });
    truck = await seedAsset(ctx.app, director.token, { assetCode: "XLS-429" });
    current = currentPeriodCode(new Date(), "Africa/Douala");

    const kept = await record(director, "record-expense", "REPAIRS", 30_000, `${current}-02`);
    const twice = await record(director, "record-expense", "REPAIRS", 45_000, `${current}-03`);
    ids["twiceCancellation"] = await cancel(twice, "Saisie en double");
    await record(director, "record-revenue", "FREIGHT_REVENUE", 250_000, `${current}-04`);
    const rejected = await record(driver, "record-expense", "REPAIRS", 300_000, `${current}-05`);
    expect(await statusOf(rejected.entryId)).toBe("SUBMITTED");
    await api.ok(
      finance.token,
      "reject-entry",
      { entryId: rejected.entryId, reason: "Pas de reçu" },
      { expectedVersion: await rowVersionOf(rejected.entryId) },
    );
    const own = await record(driver, "record-expense", "REPAIRS", 4_000, `${current}-06`);
    await approveIfPending(own.entryId);
    const others = await record(otherDriver, "record-expense", "REPAIRS", 6_000, `${current}-07`);
    await approveIfPending(others.entryId);

    // A cancellation in a later month than its original (#427).
    const may = await record(director, "record-expense", "REPAIRS", 80_000, `${MAY}-14`);
    const periods = periodsResponse.parse((await api.get(director.token, "/v1/finance/periods")).body);
    await api.ok(
      director.token,
      "lock-period",
      { periodCode: MAY },
      { expectedVersion: periods.periods.find((period) => period.periodCode === MAY)!.rowVersion },
    );
    ids["mayCancellation"] = await cancel(may, "N'a pas eu lieu");

    Object.assign(ids, {
      kept: kept.entryId,
      twice: twice.entryId,
      rejected: rejected.entryId,
      own: own.entryId,
      others: others.entryId,
      may: may.entryId,
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function record(actor: Actor, command: string, categoryCode: string, amountMinor: number, economicDate: string) {
    const entryId = randomUUID();
    const result = await api.ok(actor.token, command, {
      entryId,
      branchCode: "DLA",
      categoryCode,
      economicDate,
      amountMinor,
      paymentMethod: "CASH",
      postings: [{ assetId: truck, amountMinor }],
    });
    return { entryId, rowVersion: result.rowVersion };
  }

  async function detail(entryId: string) {
    const response = await api.get(finance.token, `/v1/finance/entries/${entryId}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as { status: string; rowVersion: number; entryNumber: string };
  }

  const statusOf = async (entryId: string) => (await detail(entryId)).status;
  const rowVersionOf = async (entryId: string) => (await detail(entryId)).rowVersion;

  async function approveIfPending(entryId: string) {
    const entry = await detail(entryId);
    if (entry.status === "SUBMITTED") {
      await api.ok(finance.token, "approve-entry", { entryId }, { expectedVersion: entry.rowVersion });
    }
  }

  async function cancel(entry: { entryId: string; rowVersion: number }, reason: string) {
    const reversalEntryId = randomUUID();
    await api.ok(
      finance.token,
      "reverse-entry",
      { reversalEntryId, originalEntryId: entry.entryId, reason },
      { expectedVersion: await rowVersionOf(entry.entryId) },
    );
    return reversalEntryId;
  }

  async function exportFile(token: string, query: string, app = ctx.app) {
    const response = await app.inject({
      method: "GET",
      url: `/v1/finance/entries/export?${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
    return response;
  }

  async function exported(token: string, query: string) {
    const response = await exportFile(token, query);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    return { file: readXlsx(response.rawPayload), disposition: String(response.headers["content-disposition"]) };
  }

  /**
   * The Check sheet's fixed ROUTIQ figures, and the same sums worked out
   * from the Entries and Books cells as its SUMIFS formulas do.
   */
  function checkFigures(file: ReturnType<typeof readXlsx>, words: { expense: string; revenue: string; yes: string }) {
    const [entriesName, booksName, checkName] = file.names as [string, string, string];
    const check = file.sheets.get(checkName)!;
    const currency = check.get("B8")!.value;
    const entries = table(file.sheets.get(entriesName)!);
    const books = table(file.sheets.get(booksName)!);
    const entryHeaders = [...file.sheets.get(entriesName)!].filter(([ref]) => /^[A-Z]+1$/.test(ref));
    const [typeColumn, amountColumn, currencyColumn, totalsColumn] = [6, 7, 8, 9].map(
      (index) => entryHeaders[index]![1].value,
    ) as [string, string, string, string];
    const bookHeaders = [...file.sheets.get(booksName)!].filter(([ref]) => /^[A-Z]+1$/.test(ref));
    const countsColumn = bookHeaders[13]![1].value;
    const ofType = (type: string) => (row: Record<string, XlsxCell | undefined>) =>
      row[typeColumn]?.value === type && row[currencyColumn]?.value === currency;
    return {
      routiq: { expense: Number(check.get("B11")!.value), revenue: Number(check.get("B12")!.value) },
      entries: {
        expense: sumWhere(entries, totalsColumn, ofType(words.expense)),
        revenue: sumWhere(entries, totalsColumn, ofType(words.revenue)),
      },
      books: {
        expense: sumWhere(books, amountColumn, (row) => ofType(words.expense)(row) && row[countsColumn]?.value === words.yes),
        revenue: sumWhere(books, amountColumn, (row) => ofType(words.revenue)(row) && row[countsColumn]?.value === words.yes),
      },
      check,
      entries_: entries,
      books_: books,
      columns: { amountColumn, totalsColumn },
    };
  }

  const FR = { expense: "Dépense", revenue: "Recette", yes: "oui" };

  async function summary(token: string) {
    const response = await api.get(token, "/v1/finance/summary");
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return financeSummaryResponse.parse(response.body);
  }

  it("matches the Money page's totals for one month, to the franc, with rejected entries left out", async () => {
    const { file, disposition } = await exported(director.token, `economicMonth=${current}&lang=fr`);
    expect(file.names).toEqual(["Écritures", "Grand livre", "Contrôle"]);
    expect(disposition).toContain(`-ecritures-${current}.xlsx`);
    expect(file.workbook).toContain('<calcPr fullCalcOnLoad="1"/>');

    const figures = checkFigures(file, FR);
    const money = await summary(director.token);
    expect(money.month).toBe(current);
    expect(figures.routiq).toEqual({ expense: money.outMinor, revenue: money.inMinor });
    expect(figures.entries).toEqual(figures.routiq);
    expect(figures.books).toEqual(figures.routiq);
    // 30 000 + 4 000 + 6 000; the cancelled pair nets 0, the rejected 300 000 never counts.
    expect(figures.routiq).toEqual({ expense: 40_000, revenue: 250_000 });

    // The formulas the spreadsheet recalculates, beside ROUTIQ's own number.
    expect(figures.check.get("C11")).toMatchObject({
      kind: "formula",
      value: `SUMIFS('Écritures'!$J:$J,'Écritures'!$G:$G,"Dépense",'Écritures'!$I:$I,$B$8)`,
    });
    expect(figures.check.get("D11")?.value).toBe(
      `SUMIFS('Grand livre'!$H:$H,'Grand livre'!$G:$G,"Dépense",'Grand livre'!$I:$I,$B$8,'Grand livre'!$N:$N,"oui")`,
    );
    expect(figures.check.get("E11")?.value).toBe(`IF(AND(B11=C11,B11=D11),"oui","non")`);
    expect(figures.check.get("A15")?.value).toBe("Concorde avec ROUTIQ");

    // One line per event: the cancelled pair is one line counting 0, the books keep both rows.
    const twice = (await detail(ids["twice"]!)).entryNumber;
    const lines = figures.entries_.filter((row) => row["N°"]?.value === twice);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      Montant: { kind: "number", value: "45000" },
      "Compte dans les totaux": { kind: "number", value: "0" },
      Statut: { value: "Annulée" },
      "Motif d'annulation": { value: "Saisie en double" },
      "Saisie par": { value: "Direction 429" },
      Date: { kind: "number", value: excelSerial(`${current}-03`) },
    });
    expect(figures.books_.filter((row) => row["Annule l'écriture"]?.value === twice)).toHaveLength(1);

    // A rejected entry is listed as rejected, with nothing in the totals column: missing, not 0.
    const rejectedNumber = (await detail(ids["rejected"]!)).entryNumber;
    const rejectedLine = figures.entries_.find((row) => row["N°"]?.value === rejectedNumber);
    expect(rejectedLine?.["Statut"]?.value).toBe("Rejetée");
    expect(rejectedLine?.["Compte dans les totaux"]).toBeUndefined();
    expect(rejectedLine?.["Approuvée par"]).toBeUndefined();
  });

  it("matches the vehicle Money tab for a posting period, the later-month cancellation included", async () => {
    const tab = async (periodCode: string) => {
      const response = await api.get(director.token, `/v1/assets/${truck}/finance?periodCode=${periodCode}`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return assetFinanceResponse.parse(response.body).posted;
    };

    for (const periodCode of [current, MAY]) {
      const { file, disposition } = await exported(
        director.token,
        `assetId=${truck}&status=LEDGER&periodCode=${periodCode}&lang=fr`,
      );
      expect(disposition).toContain(`-xls-429-${periodCode}.xlsx`);
      const figures = checkFigures(file, FR);
      const posted = await tab(periodCode);
      expect(figures.routiq).toEqual({ expense: posted.expenseMinor, revenue: posted.revenueMinor });
      expect(figures.entries).toEqual(figures.routiq);
      expect(figures.books).toEqual(figures.routiq);
      expect(figures.check.get("B3")?.value).toBe("Véhicule XLS-429");
    }

    const mayNumber = (await detail(ids["may"]!)).entryNumber;
    const inCurrent = checkFigures((await exported(director.token, `assetId=${truck}&status=LEDGER&periodCode=${current}`)).file, FR);
    expect(inCurrent.entries_.find((row) => row["Montant"]?.value === "-80000")).toMatchObject({
      Statut: { value: `Annulation de l'écriture ${mayNumber}` },
      "Motif d'annulation": { value: "N'a pas eu lieu" },
      "Saisie par": { value: "Finance 429" },
    });
    const inMay = checkFigures((await exported(director.token, `assetId=${truck}&status=LEDGER&periodCode=${MAY}`)).file, FR);
    const months = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
    const monthWord = `${months[Number(current.slice(5)) - 1]} ${current.slice(0, 4)}`;
    expect(inMay.entries_.find((row) => row["N°"]?.value === mayNumber)).toMatchObject({
      "Compte dans les totaux": { value: "80000" },
      Statut: { value: `Annulée en ${monthWord}` },
    });
  });

  it("writes headers and sheet names in English when asked", async () => {
    const { file, disposition } = await exported(director.token, `economicMonth=${current}&lang=en`);
    expect(file.names).toEqual(["Entries", "Books", "Check"]);
    expect(disposition).toContain(`-entries-${current}.xlsx`);
    const header = [...file.sheets.get("Entries")!].filter(([ref]) => /^[A-Z]+1$/.test(ref)).map(([, cell]) => cell.value);
    expect(header).toEqual([
      "Date",
      "No.",
      "Vehicle",
      "Trip",
      "Category",
      "Description",
      "Type",
      "Amount",
      "Currency",
      "Counts in totals",
      "Status",
      "Cancellation reason",
      "Recorded by",
      "Approved by",
    ]);
    const figures = checkFigures(file, { expense: "Expense", revenue: "Revenue", yes: "yes" });
    expect(figures.entries).toEqual(figures.routiq);
    expect(figures.books).toEqual(figures.routiq);
    expect(figures.check.get("A15")?.value).toBe("Matches ROUTIQ");
  });

  it("gives a driver their own entries only, with the totals their Money page shows", async () => {
    const { file } = await exported(driver.token, `economicMonth=${current}`);
    const figures = checkFigures(file, FR);
    const money = await summary(driver.token);
    expect(figures.routiq).toEqual({ expense: money.outMinor, revenue: money.inMinor });
    expect(figures.entries).toEqual(figures.routiq);
    expect(figures.books).toEqual(figures.routiq);

    const numbers = new Set(figures.books_.map((row) => row["N°"]?.value));
    const own = await detail(ids["own"]!);
    const rejected = await detail(ids["rejected"]!);
    expect(numbers).toEqual(new Set([own.entryNumber, rejected.entryNumber]));
    for (const key of ["others", "kept", "twice", "twiceCancellation"]) {
      expect(numbers.has((await detail(ids[key]!)).entryNumber)).toBe(false);
    }
    expect(figures.check.get("B6")?.value).toContain("Vos écritures uniquement");
  });

  it("lists every row the list lists, the books view counted row for row", async () => {
    const list = await api.get(director.token, `/v1/finance/entries?limit=100&view=books&economicMonth=${current}`);
    const books = financialEntryListResponse.parse(list.body).entries;
    const { file } = await exported(director.token, `economicMonth=${current}`);
    const figures = checkFigures(file, FR);
    expect(figures.books_.map((row) => row["N°"]?.value).sort()).toEqual(books.map((entry) => entry.entryNumber).sort());
    expect(figures.entries_.every((row) => row["Montant"]?.kind === "number")).toBe(true);
  });

  it("refuses above the row limit with a stable code", async () => {
    const small = buildServer({ db: ctx.runtimeDb, authDb: ctx.db, logger: false, entryExportRowLimit: 2 });
    await small.ready();
    try {
      const response = await exportFile(director.token, `economicMonth=${current}`, small);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: "EXPORT_TOO_LARGE", metadata: { limit: 2 } } });
      expect(response.json().error.metadata.count).toBeGreaterThan(2);
    } finally {
      await small.close();
    }
  });

  it("refuses an unknown language", async () => {
    const response = await exportFile(director.token, "lang=de");
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });
});
