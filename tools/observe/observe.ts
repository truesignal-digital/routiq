import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { APPROVALS, DEVICES, ERRORS, FIELD_P75, JOURNEYS, LAG, LEDGER, REJECTIONS, VITALS, VOLUME } from "./queries.js";

export type Row = Record<string, unknown>;

/** A read-only session: the owner role sees every tenant, so it must not be able to write. */
export async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url, options: "-c default_transaction_read_only=on -c statement_timeout=30000" });
  await client.connect();
  return client;
}

export async function rows(client: pg.Client, sql: string, params: unknown[]): Promise<Row[]> {
  return (await client.query(sql, params)).rows as Row[];
}

/** `7d`, `24h`, `30m` → a Postgres interval. */
export function parseWindow(raw: string): string {
  const match = /^(\d+)(d|h|m)$/.exec(raw);
  if (match === null) throw new Error(`--since must look like 7d, 24h or 30m, got "${raw}"`);
  const unit = { d: "days", h: "hours", m: "minutes" }[match[2] as "d" | "h" | "m"];
  return `${match[1]} ${unit}`;
}

/** Server time per route from the API's `request.completed` log lines (pino JSON). */
export function routeTimings(log: string): Row[] {
  const byRoute = new Map<string, { durations: number[]; errors: number }>();
  for (const line of log.split("\n")) {
    if (!line.startsWith("{") || !line.includes('"request.completed"')) continue;
    let entry: { event?: string; method?: string; route?: string; url?: string; statusCode?: number; durationMs?: number };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }
    if (entry.event !== "request.completed" || typeof entry.durationMs !== "number") continue;
    const key = `${entry.method ?? "?"} ${entry.route ?? entry.url?.split("?")[0] ?? "?"}`;
    const bucket = byRoute.get(key) ?? { durations: [], errors: 0 };
    bucket.durations.push(entry.durationMs);
    if ((entry.statusCode ?? 0) >= 500) bucket.errors += 1;
    byRoute.set(key, bucket);
  }
  return [...byRoute.entries()]
    .map(([route, { durations, errors }]) => {
      const sorted = [...durations].sort((a, b) => a - b);
      const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
      return { route, n: sorted.length, p50Ms: Math.round(at(0.5)), p95Ms: Math.round(at(0.95)), maxMs: Math.round(sorted.at(-1) ?? 0), errors5xx: errors };
    })
    .sort((a, b) => b.p95Ms - a.p95Ms)
    .slice(0, 15);
}

export interface Report {
  window: string;
  volume: Row;
  ledger: Row[];
  rejections: Row[];
  lag: Row[];
  approvals: Row;
  errors: Row[];
  devices: Row[];
  journeys: Row[];
  vitals: Row[];
  routes: Row[] | undefined;
}

export async function buildReport(client: pg.Client, window: string, apiLog: string | undefined): Promise<Report> {
  const q = (sql: string) => rows(client, sql, [window]);
  return {
    window,
    volume: (await q(VOLUME))[0] ?? {},
    ledger: await q(LEDGER),
    rejections: await q(REJECTIONS),
    lag: await q(LAG),
    approvals: (await q(APPROVALS))[0] ?? {},
    errors: await q(ERRORS),
    devices: await q(DEVICES),
    journeys: await q(JOURNEYS),
    vitals: await q(VITALS),
    routes: apiLog === undefined || !existsSync(apiLog) ? undefined : routeTimings(readFileSync(apiLog, "utf8")),
  };
}

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return "–";
  if (value instanceof Date) return value.toISOString().slice(0, 16).replace("T", " ");
  return String(value);
};

/** A plain aligned table; long text columns are cut so a row stays on one line. */
export function table(data: Row[], columns?: string[], maxWidth = 60): string {
  if (data.length === 0) return "  (none)\n";
  const keys = columns ?? Object.keys(data[0] ?? {});
  const text = data.map((row) => keys.map((key) => {
    const value = cell(row[key]);
    return value.length > maxWidth ? `${value.slice(0, maxWidth - 1)}…` : value;
  }));
  const widths = keys.map((key, i) => Math.max(key.length, ...text.map((line) => line[i]?.length ?? 0)));
  const line = (values: string[]) => `  ${values.map((value, i) => value.padEnd(widths[i] ?? 0)).join("  ").trimEnd()}`;
  return `${[line(keys), ...text.map(line)].join("\n")}\n`;
}

export function renderReport(report: Report): string {
  const v = report.volume;
  const out: string[] = [];
  const section = (title: string, why: string, body: string) => out.push(`\n${title}\n  ${why}\n${body}`);
  out.push(`ROUTIQ observe, last ${report.window}: ${cell(v["commands"])} commands in ${cell(v["workspaces"])} workspace(s); ${cell(v["events"])} telemetry events from ${cell(v["sessions"])} page loads across ${cell(v["releases"])} release(s).`);
  section("Command ledger", "Every write, by command. failPct is rejected + failed; p50/p95 are server ms.", table(report.ledger));
  section("Why writes are refused", "Stable error codes, most frequent first. A form that keeps producing one is a UX bug.", table(report.rejections));
  section("Write lag", "Seconds from the user's action to the server executing it. Offline capture shows up as large values.", table(report.lag));
  section("Approval wait", "Money entries that needed a decision.", table([report.approvals]));
  section("Client errors", "Grouped by fingerprint; one row is one problem.", table(report.errors, ["count", "sessions", "source", "message", "routes", "releases", "lastSeen"], 70));
  section("Devices", "What page loads ran on.", table(report.devices));
  section("Journeys", "From a user's action to its result on screen. serverP50Ms is the request's own server time.", table(report.journeys));
  section("Web vitals", "p75 per vital (ms; CLS unitless), and the share of loads inside the 'good' threshold.", table(report.vitals));
  if (report.routes !== undefined) section("Server routes (API log)", "Slowest routes by p95.", table(report.routes));
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Field ratchet (stage 3): a journey or vital's p75 in the newest release may
// not rise above its ceiling, but only once that release has enough samples.

export interface FieldCeiling {
  kind: "journey" | "vital";
  name: string;
  p75: number;
  minSamples: number;
}

const CEILINGS_PATH = fileURLToPath(new URL("./field-ceilings.json", import.meta.url));

export function readFieldCeilings(file = CEILINGS_PATH): FieldCeiling[] {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as FieldCeiling[]) : [];
}

export function writeFieldCeilings(ceilings: FieldCeiling[], file = CEILINGS_PATH): void {
  const sorted = [...ceilings].sort((a, b) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`));
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
}

export type FieldVerdict =
  | { ceiling: FieldCeiling; status: "thin"; n: number; release: string | undefined }
  | { ceiling: FieldCeiling; status: "ok" | "over" | "slack"; n: number; release: string; p75: number };

/** Field numbers are noisy, so a ceiling counts as slack only when p75 is 10% under it. */
export function judgeField(ceiling: FieldCeiling, sample: { n: number; p75: number; release: string } | undefined): FieldVerdict {
  if (sample === undefined || sample.n < ceiling.minSamples) return { ceiling, status: "thin", n: sample?.n ?? 0, release: sample?.release };
  const status = sample.p75 > ceiling.p75 ? "over" : sample.p75 < ceiling.p75 * 0.9 ? "slack" : "ok";
  return { ceiling, status, n: sample.n, release: sample.release, p75: sample.p75 };
}

export async function fieldSample(client: pg.Client, window: string, ceiling: Pick<FieldCeiling, "kind" | "name">): Promise<{ n: number; p75: number; release: string } | undefined> {
  const [row] = await rows(client, FIELD_P75, [window, ceiling.kind, ceiling.name]);
  if (row === undefined) return undefined;
  return { n: Number(row["n"]), p75: Number(row["p75"]), release: String(row["release"]) };
}
